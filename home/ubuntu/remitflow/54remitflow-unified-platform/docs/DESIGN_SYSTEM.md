# Nigerian Remittance Platform - Unified Design System

## Brand Identity

### Brand Colors

| Color | Hex | Usage |
|-------|-----|-------|
| Primary Blue | #1A56DB | Primary actions, links, focus states |
| Primary Blue Light | #3B82F6 | Hover states, secondary emphasis |
| Primary Blue Dark | #1E40AF | Active states, headers |
| Success Green | #059669 | Success states, positive values, completed |
| Warning Orange | #D97706 | Warnings, pending states |
| Error Red | #DC2626 | Errors, destructive actions |
| Neutral 900 | #111827 | Primary text |
| Neutral 600 | #4B5563 | Secondary text |
| Neutral 400 | #9CA3AF | Placeholder text |
| Neutral 100 | #F3F4F6 | Backgrounds, dividers |
| White | #FFFFFF | Cards, surfaces |

### Typography Scale

| Style | Size | Weight | Line Height | Usage |
|-------|------|--------|-------------|-------|
| Display | 48px | Bold | 56px | Hero sections |
| H1 | 32px | Bold | 40px | Page titles |
| H2 | 24px | SemiBold | 32px | Section headers |
| H3 | 20px | SemiBold | 28px | Card titles |
| H4 | 18px | Medium | 24px | Subsections |
| Body Large | 16px | Regular | 24px | Primary content |
| Body | 14px | Regular | 20px | Secondary content |
| Caption | 12px | Regular | 16px | Labels, hints |
| Overline | 10px | Medium | 14px | Tags, badges |

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| xs | 4px | Tight spacing |
| sm | 8px | Component internal |
| md | 16px | Standard spacing |
| lg | 24px | Section spacing |
| xl | 32px | Large gaps |
| 2xl | 48px | Page sections |
| 3xl | 64px | Hero sections |

### Border Radius

| Token | Value | Usage |
|-------|-------|-------|
| sm | 4px | Small elements |
| md | 8px | Buttons, inputs |
| lg | 12px | Cards |
| xl | 16px | Modals |
| full | 9999px | Pills, avatars |

### Shadows

| Token | Value | Usage |
|-------|-------|-------|
| sm | 0 1px 2px rgba(0,0,0,0.05) | Subtle elevation |
| md | 0 4px 6px rgba(0,0,0,0.1) | Cards |
| lg | 0 10px 15px rgba(0,0,0,0.1) | Dropdowns |
| xl | 0 20px 25px rgba(0,0,0,0.15) | Modals |

## Component Specifications

### Buttons

#### Primary Button
- Background: Primary Blue (#1A56DB)
- Text: White
- Padding: 12px 24px
- Border Radius: 8px
- Font: 14px Medium
- Hover: Primary Blue Light (#3B82F6)
- Active: Primary Blue Dark (#1E40AF)
- Disabled: 50% opacity

#### Secondary Button
- Background: Neutral 100 (#F3F4F6)
- Text: Neutral 900 (#111827)
- Border: 1px solid Neutral 300 (#D1D5DB)
- Hover: Neutral 200 (#E5E7EB)

#### Ghost Button
- Background: Transparent
- Text: Primary Blue
- Hover: Primary Blue 10% opacity background

### Input Fields

- Height: 48px
- Padding: 12px 16px
- Border: 1px solid Neutral 300
- Border Radius: 8px
- Focus: 2px Primary Blue ring
- Error: Error Red border + message below
- Label: Caption style, Neutral 600

### Cards

- Background: White
- Border: 1px solid Neutral 100
- Border Radius: 12px
- Padding: 24px
- Shadow: md

### Navigation

#### Bottom Navigation (Mobile)
- Height: 64px
- Background: White
- Shadow: 0 -2px 10px rgba(0,0,0,0.1)
- Active: Primary Blue icon + label
- Inactive: Neutral 400 icon

#### Top Navigation (Web)
- Height: 64px
- Background: White
- Shadow: sm
- Logo left, actions right

## Animation Guidelines

### Timing Functions
- ease-out: 0.25s - Page transitions
- ease-in-out: 0.2s - Hover states
- spring: 0.3s - Interactive elements

### Micro-interactions
- Button press: Scale 0.98
- Card hover: Translate Y -2px, shadow increase
- Input focus: Border color transition
- Success: Checkmark animation
- Loading: Skeleton shimmer

## Accessibility

- Minimum touch target: 44x44px
- Color contrast: WCAG AA (4.5:1 for text)
- Focus indicators: 2px ring
- Screen reader labels on all interactive elements

## Platform-Specific Notes

### Android (Jetpack Compose)
- Use Material 3 components
- Follow Material You dynamic color when available
- Use Compose animations for micro-interactions

### iOS (SwiftUI)
- Use SF Pro font family
- Follow iOS Human Interface Guidelines
- Use SwiftUI animations

### PWA (React/Tailwind)
- Use Tailwind CSS utilities
- CSS transitions for animations
- Framer Motion for complex animations
