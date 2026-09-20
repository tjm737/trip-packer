import { NextResponse } from "next/server";

import { readState, tx } from "@/lib/db";
import type { Category, PackingItem, Reservation, Task, Trip, User } from "@/lib/types";

export const dynamic = "force-dynamic";

/*
 * POST /api/mutate — single write endpoint.
 *
 * Rationale for one endpoint instead of REST-per-entity: the client already
 * speaks in terms of a normalized in-memory store, and the previous storage
 * layer exposed exactly these operations. Mirroring that shape keeps the
 * AppContext action methods as thin wrappers rather than a rewrite.
 *
 * Every handler returns the full fresh state so the client never has to guess
 * what the server actually persisted — this is what makes the optimistic
 * update in AppContext safe to reconcile.
 */

type Body =
  | { op: "user.add"; name: string; user: User }
  | { op: "user.update"; id: string; updates: Partial<User> }
  | { op: "user.delete"; id: string }
  | { op: "user.switch"; id: string }
  | { op: "trip.create"; trip: Trip }
  | { op: "trip.update"; id: string; updates: Partial<Trip> }
  | { op: "trip.delete"; id: string }
  | { op: "category.create"; category: Category }
  | { op: "category.update"; id: string; updates: Partial<Category> }
  | { op: "category.delete"; id: string }
  | { op: "item.create"; item: PackingItem }
  | { op: "item.update"; id: string; updates: Partial<PackingItem> }
  | { op: "item.delete"; id: string }
  | { op: "task.create"; task: Task }
  | { op: "task.update"; id: string; updates: Partial<Task> }
  | { op: "task.delete"; id: string }
  | { op: "reservation.create"; reservation: Reservation }
  | { op: "reservation.update"; id: string; updates: Partial<Reservation> }
  | { op: "reservation.delete"; id: string }
  | { op: "state.replace"; state: NonNullable<ReturnType<typeof readState>> };

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    switch (body.op) {
      case "user.add":
        tx.insertUser(body.user);
        tx.setActiveUser(body.user.id);
        break;

      case "user.update":
        tx.updateUser(body.id, body.updates);
        break;

      case "user.delete": {
        const current = readState();
        // Mirrors the old storage.ts guard: never delete the last user, since
        // the app has no concept of a user-less state.
        if (!current || current.users.length <= 1) {
          return NextResponse.json(
            { error: "Cannot delete the last user" },
            { status: 400 }
          );
        }
        tx.deleteUser(body.id);
        const after = readState();
        if (after && after.activeUserId === body.id) {
          tx.setActiveUser(after.users[0].id);
        }
        break;
      }

      case "user.switch":
        tx.setActiveUser(body.id);
        break;

      case "trip.create":
        tx.insertTrip(body.trip);
        break;

      case "trip.update":
        tx.updateTrip(body.id, body.updates);
        break;

      case "trip.delete":
        tx.deleteTrip(body.id);
        break;

      case "category.create":
        tx.insertCategory(body.category);
        break;

      case "category.update":
        tx.updateCategory(body.id, body.updates);
        break;

      case "category.delete":
        tx.deleteCategory(body.id);
        break;

      case "item.create":
        tx.insertItem(body.item);
        break;

      case "item.update":
        tx.updateItem(body.id, body.updates);
        break;

      case "item.delete":
        tx.deleteItem(body.id);
        break;

      case "task.create":
        tx.insertTask(body.task);
        break;

      case "task.update":
        tx.updateTask(body.id, body.updates);
        break;

      case "task.delete":
        tx.deleteTask(body.id);
        break;

      case "reservation.create":
        tx.insertReservation(body.reservation);
        break;

      case "reservation.update":
        tx.updateReservation(body.id, body.updates);
        break;

      case "reservation.delete":
        tx.deleteReservation(body.id);
        break;

      case "state.replace":
        tx.replaceAll(body.state);
        break;

      default:
        return NextResponse.json({ error: "Unknown op" }, { status: 400 });
    }

    return NextResponse.json({ state: readState() });
  } catch (err) {
    console.error(`[api/mutate] ${body.op} failed:`, err);
    return NextResponse.json({ error: "Mutation failed" }, { status: 500 });
  }
}
