import AsyncStorage from '@react-native-async-storage/async-storage';
import { FEATURES } from '../config/features';

const KEYS = {
  USAGE: 'ml_usage_daily',
};

const DAILY_LIMITS = {
  search: 5,
  save: 3,
  export: 2,
  interaction: 2,
} as const;

export type UsageFeature = keyof typeof DAILY_LIMITS;

interface UsageData {
  search: number;
  save: number;
  export: number;
  interaction: number;
  lastResetAt: number;
}

const DEFAULT_USAGE: UsageData = {
  search: 0,
  save: 0,
  export: 0,
  interaction: 0,
  lastResetAt: Date.now(),
};

function shouldReset(lastResetAt: number): boolean {
  const now = Date.now();
  const elapsed = now - lastResetAt;
  return elapsed >= 24 * 60 * 60 * 1000;
}

async function loadUsage(): Promise<UsageData> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.USAGE);
    if (!raw) return { ...DEFAULT_USAGE, lastResetAt: Date.now() };
    const data: UsageData = JSON.parse(raw);
    if (shouldReset(data.lastResetAt)) {
      return { ...DEFAULT_USAGE, lastResetAt: Date.now() };
    }
    return data;
  } catch {
    return { ...DEFAULT_USAGE, lastResetAt: Date.now() };
  }
}

async function saveUsage(data: UsageData): Promise<void> {
  try {
    await AsyncStorage.setItem(KEYS.USAGE, JSON.stringify(data));
  } catch {}
}

async function getRemaining(feature: UsageFeature): Promise<number> {
  const usage = await loadUsage();
  return Math.max(0, DAILY_LIMITS[feature] - usage[feature]);
}

async function canUse(feature: UsageFeature, isPro: boolean = false): Promise<boolean> {
  if (FEATURES.ENABLE_PRO && isPro) return true;
  const remaining = await getRemaining(feature);
  return remaining > 0;
}

async function increment(feature: UsageFeature, isPro: boolean = false): Promise<void> {
  if (FEATURES.ENABLE_PRO && isPro) return;
  const usage = await loadUsage();
  usage[feature] += 1;
  await saveUsage(usage);
}

async function getAllRemaining(): Promise<Record<UsageFeature, number>> {
  const usage = await loadUsage();
  return {
    search: Math.max(0, DAILY_LIMITS.search - usage.search),
    save: Math.max(0, DAILY_LIMITS.save - usage.save),
    export: Math.max(0, DAILY_LIMITS.export - usage.export),
    interaction: Math.max(0, DAILY_LIMITS.interaction - usage.interaction),
  };
}

async function getLimit(feature: UsageFeature): Promise<number> {
  return DAILY_LIMITS[feature];
}

export const UsageService = {
  DAILY_LIMITS,
  canUse,
  increment,
  getRemaining,
  getAllRemaining,
  getLimit,
};
