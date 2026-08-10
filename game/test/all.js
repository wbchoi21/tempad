const { execFileSync } = require("child_process");
let bad = 0;
for (const f of ["run.js", "ui.js", "pad.js", "live.js"]) {
  console.log("\n" + "=".repeat(50) + "\n  " + f + "\n" + "=".repeat(50));
  try {
    let out = execFileSync("node", [__dirname + "/" + f], {encoding:"utf8"});
    /* binjgb 가 롬 헤더를 찍는데 시끄러워서 걸러냅니다 */
    out = out.split("\n").filter(l => !/^(title|cgb flag|sgb flag|cart type|rom size|ext ram size|header checksum)/.test(l)).join("\n");
    console.log(out);
  }
  catch (e) { console.log(e.stdout || ""); bad++; }
}
console.log(bad ? "\n★ 실패한 묶음 " + bad + "개" : "\n전부 통과");
process.exit(bad ? 1 : 0);
