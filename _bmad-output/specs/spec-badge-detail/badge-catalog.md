# Badge Catalog

Detail behind CAP-1, CAP-2, CAP-4, CAP-7. 3 subjects × 2 types × 6 milestones = 36 badges, one icon each.

## Subjects

| Badge subject | Classes that count toward it | Icon motif |
|---|---|---|
| `language` | Tibetan language classes | ཀ letter |
| `dance` | Dance **and** song classes (one shared count) | Dancer figure |
| `instrument` | Instrument classes | Dranyen (lute) |

A student's counts are kept per subject. A student with no class in a subject has no track for that subject and sees none of its badges.

## Types

| Type | Counts | Icon frame | Baked-in label |
|---|---|---|---|
| `attendance` | Distinct sessions marked present in that subject's classes | Round medallion | ཉིན་ N |
| `homework` | Distinct homework instances marked Done in that subject's classes | Thangka scroll | ནང་སྦྱོང་ N |

## Milestones and tiers

Milestones come from `app_settings.badge_milestone_thresholds`. The colour tier is baked into each icon.

| Milestone | Tier colour |
|---|---|
| 1 | Bronze |
| 5 | Silver |
| 10 | Gold |
| 25 | White |
| 50 | Light blue |
| 100 | Green |

A milestone without a matching icon renders as the existing trophy pill.

## Icon files

- In the app: `static/badges/` (36 SVGs, ~604 KB total), copied from `~/Downloads/sherab-badges/svg/`; `png/` and `contact-sheet.png` there are reference only. The `sherab-badges-plain/` set is not used.
- Naming: `{subject}-{type}-{milestone}.svg`, e.g. `dance-homework-5.svg`. The name is the lookup key for a badge.
- States: earned shows the icon in full colour; locked shows the same icon greyed out.
