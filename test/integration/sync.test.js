import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createSession, context } from '../../src/cli.js';
import { git, text, head, status, branch } from '../../src/core/git.js';
import { loadState, loadJournal, saveState, withLock, stateRoot, stateFile } from '../../src/core/state.js';
import { preparePlan, transact, recover, indexFingerprint } from '../../src/core/engine.js';
import { policy, included } from '../../src/core/policy.js';

const suiteRoot=await fs.mkdtemp(path.join(os.tmpdir(),'aimp-tests-'));
process.env.XDG_STATE_HOME=path.join(suiteRoot,'state');
test.after(async()=>fs.rm(suiteRoot,{recursive:true,force:true}));
let counter=0;
async function fixture({ignore='',files={}}={}) {
  const dir=path.join(suiteRoot,String(++counter)),root=path.join(dir,'original'),mirror=path.join(dir,'mirror');
  await fs.mkdir(root,{recursive:true}); await git(root,['init','-q','-b','main']);
  await git(root,['config','user.name','Fixture']); await git(root,['config','user.email','fixture@example.invalid']);
  const write=async(base,rel,content)=>{await fs.mkdir(path.dirname(path.join(base,rel)),{recursive:true});await fs.writeFile(path.join(base,rel),content);};
  for(const [rel,data] of Object.entries({'app.txt':'before\n','.aimpignore':ignore,...files})) await write(root,rel,data);
  await git(root,['add','--all']); await git(root,['commit','-qm','initial']);
  const output=[];
  const session=createSession({root,original:root,mode:'original'},{output:v=>output.push(v),prompt:async()=> 'y'});
  await session.execute(['/init',mirror]);
  const mirrorSession=createSession({root:mirror,original:root,mode:'mirror'},{output:v=>output.push(v),prompt:async()=> 'y'});
  const report=async()=>{
    const state=await loadState(root), pair=state.pairs[await branch(mirror)];
    await write(mirror,'AIMP_REPORT.md',`Mirror-ID: ${state.projectId}\nBranch: ${pair.branch}\nBatch-ID: ${pair.batch}\nStatus: ready\n\n## Summary\nChanged fixture\nSecond summary line\n\n## Commit Message\nfix: fixture\n\n## Tests\nNot run: fixture\n\n## Notes\nNone\n`);
  };
  return {root,mirror,session,mirrorSession,write,report,output,dir};
}

test('sync preserves original HEAD and exact staging, copies modified file and checkpoints once',async()=>{
  const f=await fixture({files:{'other.txt':'base'}}),before=await head(f.root);
  await f.write(f.root,'other.txt','staged'); await git(f.root,['add','other.txt']); const index=await indexFingerprint(f.root);
  await f.write(f.mirror,'app.txt','after\n');await f.report();await f.session.execute('/sync');
  assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'after\n');
  assert.equal(await head(f.root),before);assert.equal(await indexFingerprint(f.root),index);
  assert.match(await text(f.mirror,['log','-1','--format=%s']),/\(synced\)$/);
  const checkpoint=await head(f.mirror);await f.session.execute('/sync');assert.equal(await head(f.mirror),checkpoint);
  assert.equal(await loadJournal(f.root),null);
});
test('literal names, additions, deletion, binary and executable modes survive sync',async()=>{
  const f=await fixture({files:{'delete.txt':'remove'}});
  for(const rel of ['a b.txt','日本.txt','line\nbreak.txt','-file','a..b',':(glob)*','notes-AGENTS.md.txt']) await f.write(f.mirror,rel,'literal');
  await f.write(f.mirror,'binary',Buffer.from([0,255,1]));await f.write(f.mirror,'run.sh','echo hi');await fs.chmod(path.join(f.mirror,'run.sh'),0o755);
  await fs.rm(path.join(f.mirror,'delete.txt'));await f.report();await f.session.execute('/sync');
  for(const rel of ['a b.txt','日本.txt','line\nbreak.txt','-file','a..b',':(glob)*','notes-AGENTS.md.txt']) assert.equal(await fs.readFile(path.join(f.root,rel),'utf8'),'literal');
  assert.deepEqual(await fs.readFile(path.join(f.root,'binary')),Buffer.from([0,255,1]));assert.equal((await fs.stat(path.join(f.root,'run.sh'))).mode&0o777,0o755);
  await assert.rejects(fs.stat(path.join(f.root,'delete.txt')),{code:'ENOENT'});
});
test('committed AI changes are pending and synchronize',async()=>{
  const f=await fixture();await f.write(f.mirror,'app.txt','committed');await git(f.mirror,['add','app.txt']);await git(f.mirror,['commit','-qm','AI work']);
  const result=await f.session.execute('/status');assert.equal(result.monitor.aiPending,true);
  await f.report();await f.session.execute('/sync');assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'committed');
});
test('aimpignore excludes tracked files in both directions and from checkpoint',async()=>{
  const f=await fixture({ignore:'secret.local\n',files:{'secret.local':'original-dummy'}});
  await f.write(f.mirror,'secret.local','mirror-dummy');await git(f.mirror,['add','-f','secret.local']);
  await f.write(f.mirror,'app.txt','after');await f.report();await f.session.execute('/sync');
  assert.equal(await fs.readFile(path.join(f.root,'secret.local'),'utf8'),'original-dummy');
  assert.notEqual((await git(f.mirror,['cat-file','-e','HEAD:secret.local'],{allowFailure:true})).code,0);
  assert.equal((await status(f.mirror)).some(e=>e.path==='secret.local'),true);
});
test('ignore evaluator implements negation and directory patterns without tracked gitignore leakage',async()=>{
  const f=await fixture({ignore:'*.local\n!public.local\nprivate/\n',files:{'.gitignore':'app.txt\n'}});
  const paths=await included(['app.txt','secret.local','public.local','private/a'],await policy(f.root));
  assert.deepEqual(paths,['app.txt','public.local']);
});
test('nested gitignore excludes dependencies and symlinks on initial copy',async()=>{
  const f=await fixture({files:{'nested/.gitignore':'deps/\n'}});
  await fs.mkdir(path.join(f.root,'nested/deps')); await fs.symlink('/tmp',path.join(f.root,'nested/deps/link'));
  await f.session.execute(['/reinit',path.join(f.dir,'new-mirror')]);
  await assert.rejects(fs.stat(path.join(f.dir,'new-mirror/nested/deps')),{code:'ENOENT'});
});
test('status is read-only for mirror files and does not mirror ignore changes',async()=>{
  const f=await fixture();const before=await fs.readFile(path.join(f.mirror,'AIMP_REPORT.md'));
  await f.write(f.root,'.aimpignore','new-pattern\n');await f.session.execute('/status');
  assert.deepEqual(await fs.readFile(path.join(f.mirror,'AIMP_REPORT.md')),before);
  await assert.rejects(fs.stat(path.join(f.mirror,'.aimpignore')),{code:'ENOENT'});
});
for(const kind of ['target-symlink','parent-symlink','hardlink']) test(`rejects ${kind} without touching outside data`,async()=>{
  const f=await fixture(), outside=path.join(f.dir,'outside');await fs.mkdir(outside);await fs.writeFile(path.join(outside,'app.txt'),'outside');
  if(kind==='target-symlink'){await fs.rm(path.join(f.root,'app.txt'));await fs.symlink(path.join(outside,'app.txt'),path.join(f.root,'app.txt'));await f.write(f.mirror,'app.txt','AI');}
  if(kind==='parent-symlink'){await fs.symlink(outside,path.join(f.root,'nested'));await f.write(f.mirror,'nested/app.txt','AI');}
  if(kind==='hardlink'){await fs.rm(path.join(f.root,'app.txt'));await fs.link(path.join(outside,'app.txt'),path.join(f.root,'app.txt'));await f.write(f.mirror,'app.txt','AI');}
  await f.report();await assert.rejects(f.session.execute('/sync'),/Link/);assert.equal(await fs.readFile(path.join(outside,'app.txt'),'utf8'),'outside');
});
test('changed file after preview aborts before copying or checkpointing',async()=>{
  const f=await fixture();await f.write(f.mirror,'app.txt','first');const state=await loadState(f.root),plan=await preparePlan(f.root,state),before=await head(f.mirror);
  await f.write(f.mirror,'app.txt','second');await assert.rejects(transact(state,plan,'test'),/changed after preview/);
  assert.equal(await head(f.mirror),before);assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'before\n');
});
for(const stage of ['PREPARED','FILE_0','ORIGINAL_APPLIED','REF_UPDATED','AI_CHECKPOINTED','STATE_SAVED','FINALIZED']) test(`recovers interruption at ${stage} idempotently without altering original index`,async()=>{
  const f=await fixture();await f.write(f.mirror,'app.txt','after');const state=await loadState(f.root),plan=await preparePlan(f.root,state),index=await indexFingerprint(f.root);
  await assert.rejects(transact(state,plan,'test (synced)',{fault:async name=>{if(name===stage)throw new Error('injected interruption');}}),/injected/);
  assert.ok(await loadJournal(f.root));await recover(f.root);await recover(f.root);
  assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'after');assert.equal(await indexFingerprint(f.root),index);
  assert.equal((await loadState(f.root)).history.length,1);assert.equal(await loadJournal(f.root),null);
});
test('rollback restores original content and staging without git reset',async()=>{
  const f=await fixture();await f.write(f.root,'app.txt','original edit');await git(f.root,['add','app.txt']);const index=await indexFingerprint(f.root);
  await f.write(f.mirror,'app.txt','AI');const state=await loadState(f.root),plan=await preparePlan(f.root,state);
  await assert.rejects(transact(state,plan,'test',{fault:async s=>{if(s==='FILE_0')throw new Error('stop');}}));
  await recover(f.root,'rollback');assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'original edit');assert.equal(await indexFingerprint(f.root),index);
});
test('recovery refuses to overwrite edits made after an interruption',async()=>{
  const f=await fixture();await f.write(f.mirror,'app.txt','AI');const state=await loadState(f.root),plan=await preparePlan(f.root,state);
  await assert.rejects(transact(state,plan,'test',{fault:async s=>{if(s==='FILE_0')throw new Error('stop');}}));
  await f.write(f.root,'app.txt','new edit');await assert.rejects(recover(f.root),/New edits/);assert.ok(await loadJournal(f.root));
});
test('an outstanding journal blocks a second mutation',async()=>{
  const f=await fixture();await f.write(f.mirror,'app.txt','AI');const state=await loadState(f.root),plan=await preparePlan(f.root,state);
  await assert.rejects(transact(state,plan,'test',{fault:async stage=>{if(stage==='PREPARED')throw new Error('stop');}}));
  await assert.rejects(f.session.execute('/sync'),/RECOVERY_REQUIRED/);
});
test('mirror mode serialize adopts only selected paths; other changes remain pending',async()=>{
  const f=await fixture({files:{'other.txt':'base'}});await f.write(f.mirror,'app.txt','placeholder');await f.write(f.mirror,'other.txt','AI feature');
  const originalHead=await head(f.root);await f.mirrorSession.execute(['/serialize','app.txt']);
  const result=await f.mirrorSession.execute('/status');assert.equal(result.monitor.aiPending,true);assert.equal(result.monitor.files.length,1);assert.match(result.monitor.files[0],/other/);
  assert.equal(await head(f.root),originalHead);assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'before\n');
  await assert.rejects(f.mirrorSession.execute('/sync'),/unavailable/);
  const c=await context(f.mirror);assert.equal(c.mode,'mirror');
});
test('branch switching detects pending commits before switch',async()=>{
  const f=await fixture();await git(f.root,['switch','-c','feature']);await f.session.execute('/init');assert.equal(await branch(f.mirror),'feature');
  await f.write(f.mirror,'app.txt','AI');await git(f.mirror,['add','app.txt']);await git(f.mirror,['commit','-qm','AI']);
  await git(f.root,['switch','main']);await assert.rejects(f.session.execute('/use'),/pending/);assert.equal(await branch(f.mirror),'feature');
});
test('reverse sync processes changed original paths and leaves original index and HEAD intact',async()=>{
  const f=await fixture();await f.write(f.root,'app.txt','original update');await git(f.root,['add','app.txt']);await git(f.root,['commit','-qm','update']);
  const before=await head(f.root),index=await indexFingerprint(f.root);await f.session.execute('/sync-original-to-ai');
  assert.equal(await fs.readFile(path.join(f.mirror,'app.txt'),'utf8'),'original update');assert.equal(await head(f.root),before);assert.equal(await indexFingerprint(f.root),index);
});
test('reinit rejects ancestor target and preserves original',async()=>{
  const f=await fixture();await assert.rejects(f.session.execute(['/reinit',f.dir]),/overlaps/);assert.equal(await fs.readFile(path.join(f.root,'app.txt'),'utf8'),'before\n');
});
test('reinit retains replaced contents in backup and preserves other mirror branches',async()=>{
  const f=await fixture();await git(f.root,['switch','-c','feature']);await f.session.execute('/init');await git(f.root,['switch','main']);await f.session.execute('/use');
  const dest=path.join(f.dir,'replacement');await fs.mkdir(dest);await fs.writeFile(path.join(dest,'keep.txt'),'backup');
  await f.session.execute(['/reinit',dest]);const state=await loadState(f.root);
  assert.ok(Object.values(state.pairs).every(p=>p.mirror===dest));assert.equal((await git(dest,['show-ref','--verify','refs/heads/feature'])).code,0);
  const backup=(await fs.readdir(f.dir)).find(n=>n.startsWith('replacement.aimp-backup-'));assert.equal(await fs.readFile(path.join(f.dir,backup,'keep.txt'),'utf8'),'backup');
});
test('live locks are not stolen and concurrent mutation is rejected',async()=>{
  const f=await fixture();await withLock(f.root,async()=>{await assert.rejects(withLock(f.root,async()=>{}),/locked/);});
});
test('legacy state migration backs up secrets, removes runtime secrets, requires baseline review',async()=>{
  const f=await fixture();const old=await loadState(f.root);old.schemaVersion=2;old.pairs.main.secrets={test:{value:'dummy-legacy'}};await saveState(f.root,old);
  await f.session.execute('/migrate');const next=await loadState(f.root);assert.equal(next.schemaVersion,3);assert.equal(next.pairs.main.secrets,undefined);assert.equal(next.pairs.main.baselineNeedsReview,true);
  const backups=(await fs.readdir(stateRoot())).filter(p=>p.startsWith(path.basename(stateFile(f.root))+'.v2-'));assert.equal(backups.length,1);
  await f.session.execute('/adopt-baseline');assert.equal((await loadState(f.root)).pairs.main.baselineNeedsReview,false);
});
test('language can be configured before initialization',async()=>{
  const f=await fixture();await fs.rm(stateFile(f.root));await f.session.execute('/language id');assert.equal((await loadState(f.root)).language,'id');
});
