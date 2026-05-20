import { useMutation, useQuery, useQueryClient } from 'react-query';
import { open_bankingService } from '../api/services/open_bankingService';

export const useOpenBankingService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    open_bankingService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('open-banking');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['open-banking', id],
      () => open_bankingService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['open-banking', page, pageSize],
      () => open_bankingService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
