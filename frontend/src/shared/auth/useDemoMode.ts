import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { TransparencyPayload } from '../api/types';

export function useDemoMode() {
  return useQuery({
    queryKey: ['transparency'],
    queryFn: () => api.get<TransparencyPayload>('/transparency', { anonymous: true }),
    select: (data) => data.demo_mode,
    staleTime: 60_000,
  });
}
