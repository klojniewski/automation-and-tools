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
