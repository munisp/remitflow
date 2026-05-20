import { useMutation, useQuery, useQueryClient } from 'react-query';
import { stablecoin_integrationService } from '../api/services/stablecoin_integrationService';

export const useStablecoinIntegrationService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    stablecoin_integrationService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('stablecoin-integration');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['stablecoin-integration', id],
      () => stablecoin_integrationService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['stablecoin-integration', page, pageSize],
      () => stablecoin_integrationService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
