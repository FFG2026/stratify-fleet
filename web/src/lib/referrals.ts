// Vehicle additions outside a policy's criteria are referred to the insurer. Labels and shapes only; decisions are made in the database.
export const VEHICLE_TYPES = [
  { value: 'van_3_5t', label: 'Van (up to 3.5t)' },
  { value: 'car', label: 'Car' },
  { value: 'pickup', label: 'Pickup / light truck' },
  { value: 'hgv', label: 'HGV (over 3.5t)' },
  { value: 'minibus', label: 'Minibus / passenger vehicle' },
  { value: 'other', label: 'Other' }
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number]['value'];
export const typeLabel = (v: string | null | undefined) => VEHICLE_TYPES.find(t => t.value === v)?.label ?? v ?? '—';
export const isVehicleType = (v: unknown): v is VehicleType => VEHICLE_TYPES.some(t => t.value === v);
export const parseTypes = (values: unknown[]): VehicleType[] => values.filter(isVehicleType);

export type ReferralStatus = 'awaiting_authorisation' | 'queried' | 'approved' | 'declined' | 'withdrawn';
export const statusLabel: Record<ReferralStatus, string> = {
  awaiting_authorisation: 'Awaiting authorisation', queried: 'Under query', approved: 'Authorised', declined: 'Declined', withdrawn: 'Withdrawn'
};
export const isOpen = (s: string) => s === 'awaiting_authorisation' || s === 'queried';

export type Referral = {
  id: string; fleet_id: string; policy_id: string; registration: string; make_model: string | null; vehicle_type: VehicleType;
  requested_effective_at: string; request_note: string | null; status: ReferralStatus; created_at: string; updated_at: string; period_id: string | null;
};
export type ReferralMessage = { id: string; referral_id: string; side: 'fleet' | 'insurer'; body: string; created_at: string };
