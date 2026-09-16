# TripPacker — Autonomous Build Spec

Build a full-stack Next.js web app for trip packing assistance.

## Tech Stack
- **Framework:** Next.js 15 (App Router)
- **Language:** TypeScript
- **Styling:** Tailwind CSS v4 + shadcn/ui components
- **State:** React context + localStorage for persistence (no database needed — offline-first)
- **Icons:** Lucide React
- **Animation:** Framer Motion

## Core Features

### Users
- Anonymous local users identified by a generated ID (stored in localStorage)
- User can rename themselves
- Multiple users can coexist — switch between users in a sidebar
- Each user has their own data (trips, lists, preferences)
- User avatar displayed as initials in a colored circle

### Trips
- Create, view, edit, archive trips
- Trip fields: name, destination, start date, end date, notes, icon
- Archive/deactivate trips (don't delete)
- Trip dashboard shows upcoming trips prominently
- Trip cards on home dashboard

### Packing Lists
- Every trip has a packing list
- Pre-populated with a comprehensive category-based template:
  - Clothing (tops, bottoms, underwear, socks, shoes, outerwear)
  - Toiletries (toothbrush, toothpaste, shampoo, deodorant, sunscreen, medications)
  - Electronics (phone, charger, headphones, laptop, adapter)
  - Documents (passport, ID, tickets, insurance)
  - Money (cash, credit cards)
  - Miscellaneous (sunglasses, hat, water bottle, snacks)
- Each item has: name, quantity, checked/unchecked status, custom emoji icon
- User can add custom items, rename items, delete items
- User can edit categories
- Drag reordering within categories (optional — if time)

### UI/UX
- **Modern, clean design** — think linear.app / stripe.com aesthetics
- Dark/light mode toggle
- Sidebar with: user switcher, all trips list
- Main area with trip detail view
- Packing list rendered as a beautiful checklist
- Smooth animations and transitions
- Responsive design (works on mobile)
- Toast notifications for actions
- Confirmation modals for destructive actions
- Progress indicator per trip (% items packed)

## Data Model
```
User {
  id: string
  name: string
  avatarColor: string
  createdAt: Date
}

Trip {
  id: string
  userId: string
  name: string
  destination: string
  startDate: Date
  endDate: Date
  notes: string
  icon: string (emoji)
  archived: boolean
  createdAt: Date
}

PackingItem {
  id: string
  tripId: string
  categoryId: string
  name: string
  quantity: number
  checked: boolean
  icon: string (emoji)
  order: number
}

Category {
  id: string
  tripId: string
  name: string
  icon: string (emoji)
  order: number
}
```

## Pages/Routes
- `/` — Dashboard: upcoming trips, quick actions, recent activity
- `/trips/[id]` — Trip detail with packing list
- `/trips/new` — Create new trip
- `/trips/[id]/edit` — Edit trip

## Key Interactions
1. Homepage shows upcoming trips as cards with progress bars
2. Clicking a trip opens detail with full packing list
3. Checkbox toggles items; quantity editor with +/−
4. "Add Item" button at bottom of each category
5. "Add Category" button at bottom of list
6. Sidebar shows all trips grouped (upcoming / archived)
7. User switcher at top of sidebar
8. Trip creation modal or dedicated page

## Quality Requirements
- No build errors
- No TypeScript errors
- All components typed
- Clean, readable code with comments
- Follow React best practices
- Use shadcn/ui for form components (buttons, inputs, dialogs, checkboxes)
- Tailwind for all styling — no CSS files needed
- Proper accessibility (aria labels, keyboard nav)

## Build Steps (in order)
1. Scaffold with create-next-app (TypeScript, Tailwind, App Router)
2. Install deps: framer-motion, lucide-react
3. Initialize shadcn/ui
4. Build data layer (localStorage utilities, types)
5. Build sidebar component (user switcher + trip list)
6. Build dashboard page
7. Build trip detail page with packing list
8. Build trip creation form
9. Add animations and polish
10. Test that it builds successfully
