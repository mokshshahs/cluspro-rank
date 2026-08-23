// The exact text of a real ClusPro results page cluster table, used as the
// canonical fixture across all three suites.
export const REAL_TABLE = `Cluster    Members    Representative    Weighted Score
0    123    Center    -716.1
Lowest Energy    -770.2
1    114    Center    -754.7
Lowest Energy    -872.7
2    107    Center    -620.8
Lowest Energy    -716.9
3    98    Center    -673.4
Lowest Energy    -815.4
4    80    Center    -796.3
Lowest Energy    -796.3`;

// What the parser must produce for that table.
export const REAL_CLUSTERS = [
  { cluster: 0, members: 123, center: -716.1, lowest: -770.2 },
  { cluster: 1, members: 114, center: -754.7, lowest: -872.7 },
  { cluster: 2, members: 107, center: -620.8, lowest: -716.9 },
  { cluster: 3, members: 98,  center: -673.4, lowest: -815.4 },
  { cluster: 4, members: 80,  center: -796.3, lowest: -796.3 }
];
