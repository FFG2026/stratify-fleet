export type OrgKind = 'platform' | 'insurer' | 'customer';
export type Org = { id: string; name: string; kind: OrgKind; insurer_id: string | null };
export type Policy = { id: string; reference: string; customer_id: string; insurer_id: string; starts_on: string; ends_on: string | null };
export type Membership = { organisation_id: string; role: string; active: boolean };
export type Period = {
  id: string; vehicle_id?: string; policy_id: string; registration: string; make: string; model: string;
  starts_on: string; ends_on: string | null; voided_at?: string | null; recorded_at?: string;
};
export type Page<T> = { rows: T[]; total: number; offset: number; limit: number };
export type Context = {
  user: { id: string; email: string; mustChangePassword?: boolean };
  demo: boolean;
  orgs: Org[];
  policies: Policy[];
  memberships: Membership[];
};
export type FleetOverviewRow = {
  fleet_id: string; fleet_name: string; insurer_id: string; vehicles_total: number; vehicles_on_cover: number; vehicles_scheduled: number;
};
export type Report = {
  id: string; fleet_id: string; policy_id: string | null; month_start: string; status: string; rules_source: string;
  rules_snapshot: Record<string, unknown>; generated_at: string; total_vehicle_days: number | null;
  opening_vehicles: number | null; additions: number | null; removals: number | null; closing_vehicles: number | null;
  premium_net: string | null;
};
export type ReportLine = { id: number; policy_id: string; registration: string; days: number; first_charged_date: string; last_charged_date: string; daily_rate: string; charge: string };
export type Member = { id: string; user_id: string | null; email: string; role: string; active: boolean; pending: boolean };
