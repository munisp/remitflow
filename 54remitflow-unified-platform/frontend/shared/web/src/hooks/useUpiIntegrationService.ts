import { useMutation, useQuery, useQueryClient } from 'react-query';
import { upi_integrationService } from '../api/services/upi_integrationService';

export const useUpiIntegrationService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    upi_integrationService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('upi-integration');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['upi-integration', id],
      () => upi_integrationService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['upi-integration', page, pageSize],
      () => upi_integrationService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
