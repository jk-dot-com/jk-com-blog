// Where the scripts keep their working files, and the blog's redirect table.
// Override the data folder with WAYBACK_DATA; the default is ./data next to these scripts.
const path = require("path");
const DATA = process.env.WAYBACK_DATA || path.join(__dirname, "data");
const REDIRECTS = path.join(__dirname, "..", "..", "public", "_redirects");
module.exports = { DATA, REDIRECTS };
