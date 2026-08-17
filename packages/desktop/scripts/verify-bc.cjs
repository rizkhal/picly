// Verify the noise filter + median-face preview against the REAL DB.
const path = require('path')
const { PhotoStore } = require('../dist-main/db/store.js')

const dbPath = '/Users/rizkal/Library/Application Support/picly-desktop/data/picly.db'
const store = PhotoStore.open(dbPath)

console.log('=== listPersons() (filtered) ===')
const filtered = store.listPersons()
console.log(`filtered persons: ${filtered.length}`)
console.log('top 10 by photoCount:')
for (const p of filtered.slice(0, 10)) {
  console.log(`  ${p.name}  photos=${p.photoCount} faces=${p.faceCount}`)
}

console.log('\n=== listPersons(true) (all, incl noise) ===')
const all = store.listPersons(true)
console.log(`all persons: ${all.length}`)
console.log('smallest 5 (noise):')
const noise = all.filter((p) => p.faceCount < 3 || p.photoCount < 3)
console.log(`  noise count (face<3 or photo<3): ${noise.length}`)
for (const p of noise.slice(0, 5)) {
  console.log(`  ${p.name}  photos=${p.photoCount} faces=${p.faceCount}`)
}

console.log('\n=== listPersonPreviews (median face) ===')
const ids = filtered.slice(0, 3).map((p) => p.personId)
const previews = store.listPersonPreviews(ids)
for (const pr of previews) {
  console.log(`  ${pr.personId.slice(0, 8)} -> face=${pr.faceId.slice(0, 8)} path=${pr.photoPath ? pr.photoPath.split('/').pop() : 'null'}`)
}

store.close()
