import {
  Configuration,
  DealsApi,
  PersonsApi,
  ActivitiesApi,
  StagesApi,
} from "pipedrive/v2";
import type { DealItem } from "pipedrive/v2";
import { getEnv } from "../config/env.js";

function createConfig() {
  return new Configuration({ apiKey: getEnv().PIPEDRIVE_API_TOKEN });
}

export async function validateCredentials(): Promise<void> {
  await new DealsApi(createConfig()).getDeals({ limit: 1 });
}

export async function getOpenDeals(
  ownerId: number,
  limit = 100,
): Promise<DealItem[]> {
  const dealsApi = new DealsApi(createConfig());
  const allDeals: DealItem[] = [];
  let cursor: string | undefined;

  do {
    const response = await dealsApi.getDeals({
      status: "open",
      owner_id: ownerId,
      limit: Math.min(limit - allDeals.length, 100),
      cursor,
      sort_by: "update_time",
      sort_direction: "desc",
    });
    allDeals.push(...(response.data ?? []));
    cursor = response.additional_data?.next_cursor ?? undefined;
    if (!cursor) break;
  } while (allDeals.length < limit);

  return allDeals.slice(0, limit);
}

export interface DealContact {
  id: number;
  name: string;
  email: string | null;
}

export async function getDealContacts(
  dealId: number,
): Promise<DealContact[]> {
  const personsApi = new PersonsApi(createConfig());
  const response = await personsApi.getPersons({ deal_id: dealId });
  return (response.data ?? []).map((person) => ({
    id: person.id ?? 0,
    name: person.name ?? "Unknown",
    email:
      person.emails?.find((e) => e.primary)?.value ??
      person.emails?.[0]?.value ??
      null,
  }));
}

export async function getDealActivities(dealId: number, limit = 5) {
  const activitiesApi = new ActivitiesApi(createConfig());
  const response = await activitiesApi.getActivities({
    deal_id: dealId,
    limit,
  } as any);
  return response.data ?? [];
}

/**
 * Fetch deals created in a specific pipeline within a date range.
 * Paginates through results sorted by add_time desc, stopping early
 * once deals are older than startDate.
 * Optionally includes custom fields in the response.
 */
export async function fetchDealsInRange(
  pipelineId: number,
  startDate: string, // YYYY-MM-DD
  endDate: string,   // YYYY-MM-DD
  customFieldKeys?: string[],
): Promise<DealItem[]> {
  const dealsApi = new DealsApi(createConfig());
  const start = new Date(startDate + "T00:00:00Z");
  const end = new Date(endDate + "T23:59:59Z");
  const matched: DealItem[] = [];
  let cursor: string | undefined;

  outer:
  do {
    const response = await dealsApi.getDeals({
      pipeline_id: pipelineId,
      sort_by: "add_time",
      sort_direction: "desc",
      limit: 100,
      cursor,
      ...(customFieldKeys?.length ? { custom_fields: customFieldKeys.join(",") } : {}),
    });

    for (const deal of response.data ?? []) {
      const addTime = deal.add_time ? new Date(deal.add_time) : null;
      if (!addTime) continue;

      // Sorted desc — if before start, we're done
      if (addTime < start) break outer;

      if (addTime <= end) {
        matched.push(deal);
      }
    }

    cursor = response.additional_data?.next_cursor ?? undefined;
  } while (cursor);

  return matched;
}

export async function getStagesMap(): Promise<Map<number, string>> {
  const stagesApi = new StagesApi(createConfig());
  const response = await stagesApi.getStages({} as any);
  const map = new Map<number, string>();
  for (const stage of response.data ?? []) {
    if (stage.id != null && stage.name != null) {
      map.set(stage.id, stage.name);
    }
  }
  return map;
}
