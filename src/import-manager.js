/** 导入批次管理：历史记录仅从交易行的 batch 标记派生，单一数据源 */

export function createBatchId() {
  return `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function stampImportBatch(records, meta) {
  const { batchId, fileName, format, importedAt } = meta;
  records.forEach(r => {
    r._importBatchId = batchId;
    r._importFileName = fileName;
    r._importFormat = format;
    r._importedAt = importedAt;
  });
}

/** 从 allData 派生导入历史（仅含带 _importBatchId 的文件导入） */
export function deriveImportHistory(allData, savedHistory = []) {
  const savedById = {};
  savedHistory.forEach(h => { if (h.id != null) savedById[h.id] = h; });

  const batchMap = {};
  allData.forEach(r => {
    const bid = r._importBatchId;
    if (!bid) return;
    if (!batchMap[bid]) {
      const s = savedById[bid];
      batchMap[bid] = {
        id: bid,
        source: r['来源'] || s?.source || '',
        fileName: r._importFileName || s?.fileName || '未命名文件',
        format: r._importFormat || s?.format || '',
        startMonth: r['日期']?.slice(0, 7) || s?.startMonth || '',
        endMonth: r['日期']?.slice(0, 7) || s?.endMonth || '',
        count: 0,
        importedAt: r._importedAt || s?.importedAt || ''
      };
    }
    const b = batchMap[bid];
    b.count++;
    const m = r['日期']?.slice(0, 7);
    if (m) {
      if (!b.startMonth || m < b.startMonth) b.startMonth = m;
      if (!b.endMonth || m > b.endMonth) b.endMonth = m;
    }
  });

  return Object.values(batchMap).sort((a, b) => {
    const da = a.importedAt || a.endMonth || '';
    const db = b.importedAt || b.endMonth || '';
    return db.localeCompare(da);
  });
}

export function recordsForBatch(allData, entry) {
  if (!entry?.id) return [];
  return allData.filter(r => String(r._importBatchId) === String(entry.id));
}

export function deleteConfirmMessage(entry, toDelete) {
  const fname = entry.fileName || '未命名文件';
  if (!toDelete.length) {
    return `「${fname}」当前无关联账目，仅删除这条导入记录。确认？`;
  }
  return `将删除文件「${fname}」及其 ${toDelete.length} 笔关联账目。\n\n此操作不可撤销，确认删除？`;
}
