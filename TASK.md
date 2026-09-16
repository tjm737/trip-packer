You are an expert full-stack developer. Build a complete TripPacker web app. 

**PROJECT:** /Users/tylermorgan/Desktop/trip-packer-new
**SPECS:** Read SPEC.md for full requirements.

**DO THIS IN ORDER. Do not skip steps. Do not stop until everything is done.**

## Step 1: Set up types and data layer
Create `src/lib/types.ts` with the data model (User, Trip, PackingItem, Category) and `src/lib/storage.ts` with localStorage-backed CRUD functions. Each user identified by a localStorage key. Support multiple users.

## Step 2: Build context/state provider
Create `src/lib/AppContext.tsx` — React context provider that manages users, trips, packing items. Provides functions to create/edit/delete everything. Persists to localStorage.

## Step 3: Build the Sidebar
Create `src/components/Sidebar.tsx` — Dark sidebar with:
- User switcher at top (colored avatar circles with initials, click to switch)
- "New User" button
- Trip list below (upcoming trips with dates, archived section)
- Trip cards show name, destination, progress bar (% items checked)

## Step 4: Build the Dashboard (homepage)
Create `src/app/page.tsx` — Beautiful dashboard showing:
- Welcome message with current user
- Grid of upcoming trip cards (large, prominent)
- Each card shows: trip icon, name, destination, dates, progress bar
- "Create New Trip" FAB or prominent button
- Empty state with illustration if no trips

## Step 5: Build Trip Detail Page
Create `src/app/trips/[id]/page.tsx` — Trip detail view:
- Trip header (name, destination, dates, notes, edit button)
- Packing list organized by categories
- Each category: icon, name, collapsible
- Items: checkbox, name, quantity with +/-, delete
- "Add Item" at bottom of each category
- "Add Category" at bottom of list
- Overall progress bar at top of list
- "Archive Trip" button

## Step 6: Build Trip Creation/Edit Page
Create `src/app/trips/new/page.tsx` and `src/app/trips/[id]/edit/page.tsx`:
- Form with: name, destination, start/end dates, icon picker (emoji selector), notes
- Pre-populate packing list with the standard categories and items
- Save/Cancel buttons

## Step 7: Add animations
Use framer-motion for:
- Page transitions
- Card hover effects
- Checkbox animations
- Modal/dialog slide-ins

## Step 8: Polish the UI
- Modern, clean aesthetic (Linear/Stripe inspired)
- Proper dark/light mode (use system preference by default)
- Responsive layout
- Consistent spacing and typography
- Toast notifications for actions
- Confirmation dialogs for destructive actions

## CONSTRAINTS
- Use shadcn/ui components for all form elements
- Tailwind CSS for all styling — no custom CSS files
- Lucide React for icons
- TypeScript with proper types
- NO build errors, NO TypeScript errors
- App must run on `npm run dev`

## VERIFICATION
After building, run `npx tsc --noEmit` and fix any errors.
Then run `npm run build` to verify it compiles.

**START NOW. Execute each step sequentially. Write all files. Fix all errors. Build successfully.**
