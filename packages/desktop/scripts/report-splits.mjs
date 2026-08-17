/**
 * Report how many DISTINCT person clusters each ground-truth LFW identity was
 * split into in the current store (after the scan with the new threshold).
 * A real person appearing under 2+ clusters = over-split (the "duplicate face"
 * problem).
 *
 * Usage: node scripts/report-splits.mjs <dbPath>
 */
import Database from 'better-sqlite3'

const dbPath = process.argv[2] ?? '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const db = new Database(dbPath, { readonly: true })

const gtLabel = (p) => (String(p).match(/lfw_funneled\/([^/]+)\//) || [])[1] || null

const rows = db.prepare(`
  SELECT p.path, f.person_id, per.name AS person_name, f.embedding
  FROM faces f
  JOIN photos p ON p.id = f.photo_id
  JOIN persons per ON per.id = f.person_id
`).all()

const byGt = new Map() // gt -> Map(personId -> {name, count})
for (const r of rows) {
  const gt = gtLabel(r.path)
  if (!gt) continue
  if (!byGt.has(gt)) byGt.set(gt, new Map())
  const m = byGt.get(gt)
  if (!m.has(r.person_id)) m.set(r.person_id, { name: r.person_name, count: 0 })
  m.get(r.person_id).count += 1
}

let splitCount = 0
let maxSplit = 0
let totalGt = 0
console.log('ground-truth identities -> distinct person clusters')
for (const [gt, m] of [...byGt.entries()].sort()) {
  totalGt++
  const clusters = [...m.entries()].sort((a, b) => b[1].count - a[1].count)
  const flag = clusters.length > 1 ? '  <-- SPLIT' : ''
  if (clusters.length > 1) { splitCount++; maxSplit = Math.max(maxSplit, clusters.length) }
  console.log(
    `  ${gt.padEnd(28)} ${clusters.length} cluster(s)` +
      (clusters.length > 1
        ? `  ${clusters.map(([, v]) => `${v.name}(${v.count})`).join(' + ')}`
        : `  ${clusters[0][1].name}(${clusters[0][1].count})`) +
      flag
  )
}
console.log(
  `\nidentities: ${totalGt}  split: ${splitCount} (${totalGt ? ((splitCount / totalGt) * 100).toFixed(0) : 0}%)  max_clusters: ${maxSplit}`
)
