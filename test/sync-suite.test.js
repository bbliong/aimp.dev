// Keep the integration suite imported from the top-level test glob so Node's
// test runner executes its individual cases in one worker.
import './integration/sync.test.js';
