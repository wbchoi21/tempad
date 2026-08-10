const strict = require("./idb_strict.js");
const p = require.resolve("./idb.js");
require.cache[p] = { id:p, filename:p, loaded:true, exports:strict, children:[], paths:[] };
require("./store.js");
