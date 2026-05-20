import { useMutation, useQuery, useQueryClient } from 'react-query';
import { aml_monitoringService } from '../api/services/aml_monitoringService';

export const useAmlMonitoringService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    aml_monitoringService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('aml-monitoring');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['aml-monitoring', id],
      () => aml_monitoringService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['aml-monitoring', page, pageSize],
      () => aml_monitoringService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
