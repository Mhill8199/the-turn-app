export const TEE_BOX_PRESETS = {
  tips: { id: 'tips', label: 'Black / Tips', yardageMultiplier: 1.0, badgeColor: '#18181B' },
  blues: { id: 'blues', label: 'Blue / Member', yardageMultiplier: 0.94, badgeColor: '#2563EB' },
  whites: { id: 'whites', label: 'White / Club', yardageMultiplier: 0.88, badgeColor: '#F8FAFC' },
  golds: { id: 'golds', label: 'Gold / Senior', yardageMultiplier: 0.81, badgeColor: '#EAB308' },
  forwards: { id: 'forwards', label: 'Red / Forward Tees', yardageMultiplier: 0.74, badgeColor: '#DC2626' },
};

export const HYBRID_AND_FORWARD_BAG_PRESET = [
  { club_type: 'Driver (10.5°)', carry_yards: 195, total_yards: 212, shot_shape: 'High Draw' },
  { club_type: '3 Fairway Wood', carry_yards: 175, total_yards: 188, shot_shape: 'Straight' },
  { club_type: '5 Fairway Wood', carry_yards: 162, total_yards: 172, shot_shape: 'Straight' },
  { club_type: '4 Hybrid (22°)', carry_yards: 150, total_yards: 158, shot_shape: 'High Soft' },
  { club_type: '5 Hybrid (25°)', carry_yards: 138, total_yards: 145, shot_shape: 'High Soft' },
  { club_type: '6 Hybrid (28°)', carry_yards: 126, total_yards: 132, shot_shape: 'Straight' },
  { club_type: '7 Iron', carry_yards: 115, total_yards: 120, shot_shape: 'Straight' },
  { club_type: '8 Iron', carry_yards: 104, total_yards: 108, shot_shape: 'Straight' },
  { club_type: '9 Iron', carry_yards: 92, total_yards: 95, shot_shape: 'High' },
  { club_type: 'Pitching Wedge', carry_yards: 80, total_yards: 82, shot_shape: 'High Spin' },
  { club_type: 'Sand Wedge (56°)', carry_yards: 62, total_yards: 64, shot_shape: 'High Lob' },
];

export function calibrateHoleYardage(baseBackTeeYards, teeBoxId = 'whites') {
  const preset = TEE_BOX_PRESETS[teeBoxId] || TEE_BOX_PRESETS.whites;
  return Math.round(baseBackTeeYards * preset.yardageMultiplier);
}