import { useMutation, useQuery, useQueryClient } from 'react-query';
import { nibss_integrationService } from '../api/services/nibss_integrationService';

export const useNibssIntegrationService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    nibss_integrationService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('nibss-integration');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['nibss-integration', id],
      () => nibss_integrationService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['nibss-integration', page, pageSize],
      () => nibss_integrationService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
