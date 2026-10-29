function cleanNames(values) {
  return (Array.isArray(values) ? values : [])
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

/**
 * Infer renamed entries from an edited comma-separated subcategory list.
 * Existing names are treated as stable anchors; unmatched names are paired
 * in list order only when the old and new unmatched counts are equal.
 */
export function inferSubcategoryRenames(oldValues, newValues) {
  const oldNames = cleanNames(oldValues);
  const newNames = cleanNames(newValues);
  const oldSet = new Set(oldNames);
  const newSet = new Set(newNames);
  const removed = oldNames.filter(name => !newSet.has(name));
  const added = newNames.filter(name => !oldSet.has(name));

  if (!removed.length || removed.length !== added.length) return new Map();
  return new Map(removed.map((name, index) => [name, added[index]]));
}

export function renameCategoriesInTransactions(rows, renames) {
  if (!(renames instanceof Map) || !renames.size) return 0;
  let count = 0;

  for (const row of rows || []) {
    let touched = false;
    const nextCategory = renames.get(row['分类']);
    if (nextCategory) {
      row['分类'] = nextCategory;
      touched = true;
    }
    if (Array.isArray(row.splits)) {
      for (const split of row.splits) {
        const nextSplitCategory = renames.get(split.category);
        if (!nextSplitCategory) continue;
        split.category = nextSplitCategory;
        touched = true;
      }
    }
    if (touched) count += 1;
  }

  return count;
}

export function renameSubcategoriesInTransactions(rows, category, renames) {
  if (!category || !(renames instanceof Map) || !renames.size) return 0;
  let count = 0;

  for (const row of rows || []) {
    let touched = false;
    if (row['分类'] === category) {
      const nextSubcategory = renames.get(String(row['子分类'] || ''));
      if (nextSubcategory) {
        row['子分类'] = nextSubcategory;
        touched = true;
      }
    }
    if (Array.isArray(row.splits)) {
      for (const split of row.splits) {
        if (split.category !== category) continue;
        const nextSplitSubcategory = renames.get(String(split.subcategory || ''));
        if (!nextSplitSubcategory) continue;
        split.subcategory = nextSplitSubcategory;
        touched = true;
      }
    }
    if (touched) count += 1;
  }

  return count;
}
