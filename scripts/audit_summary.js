const { auditProgram } = require('./core/program_auditor');

async function main() {
  const p10667 = await auditProgram(10667);
  const p10713 = await auditProgram(10713);

  console.log('=== LATEST AUDIT SUMMARY ===');
  console.log(`Program 10667 (師培): ${p10667.recognized} / ${p10667.totalRequired} ${p10667.unit} (缺額: ${p10667.shortfall})`);
  console.log(`Program 10713 (岡山): ${p10713.recognized} / ${p10713.totalRequired} ${p10713.unit} (必修不足: ${p10713.requiredShortfall})`);

  const onlineIncomplete = p10713.nodes.filter(n => n.deficit > 0 && n.mode !== '面授');
  const f2fIncomplete = p10713.nodes.filter(n => n.deficit > 0 && n.mode === '面授');

  console.log(`\nRemaining Online Mandatory Incomplete (${onlineIncomplete.length}):`);
  onlineIncomplete.forEach(n => console.log(`  - [${n.sectionNum}] ${n.categoryName || n.courseTitle} (缺 ${n.deficit} ${p10713.unit})`));

  console.log(`\nRemaining Face-to-Face (實體面授) Incomplete (${f2fIncomplete.length}):`);
  f2fIncomplete.forEach(n => console.log(`  - [${n.sectionNum}] ${n.categoryName || n.courseTitle} (缺 ${n.deficit} ${p10713.unit})`));
}

main().catch(console.error);
