// The local Console UI server. An application of the runtime: nothing in the runtime imports it.
// This is the published entry: other modules and the CLIs import only from here.

export { startConsole } from './server.mjs';
