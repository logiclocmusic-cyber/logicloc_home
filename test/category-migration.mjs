import assert from 'node:assert/strict';
import {
  inferSubcategoryRenames,
  renameCategoriesInTransactions,
  renameSubcategoriesInTransactions,
} from '../src/category-migration.js';

const rows = [
  { id: 1, 分类: '交通出行', 子分类: '打车' },
  {
    id: 2,
    分类: '其他',
    子分类: '',
    splits: [
      { category: '交通出行', subcategory: '打车' },
      { category: '餐饮美食', subcategory: '堂食' },
    ],
  },
];

assert.deepEqual(
  [...inferSubcategoryRenames(['地铁', '打车'], ['地铁', '网约车'])],
  [['打车', '网约车']],
);
assert.equal(
  inferSubcategoryRenames(['地铁', '打车'], ['地铁', '打车', '公交']).size,
  0,
  'adding a subcategory must not be mistaken for a rename',
);

assert.equal(renameCategoriesInTransactions(rows, new Map([['交通出行', '日常交通']])), 2);
assert.equal(rows[0].分类, '日常交通');
assert.equal(rows[1].splits[0].category, '日常交通');

assert.equal(
  renameSubcategoriesInTransactions(rows, '日常交通', new Map([['打车', '网约车']])),
  2,
);
assert.equal(rows[0].子分类, '网约车');
assert.equal(rows[1].splits[0].subcategory, '网约车');
assert.equal(rows[1].splits[1].subcategory, '堂食');

console.log('category migration tests passed');
