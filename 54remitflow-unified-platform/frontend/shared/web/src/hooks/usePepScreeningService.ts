import { useMutation, useQuery, useQueryClient } from 'react-query';
import { pep_screeningService } from '../api/services/pep_screeningService';

export const usePepScreeningService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    pep_screeningService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('pep-screening');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['pep-screening', id],
      () => pep_screeningService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['pep-screening', page, pageSize],
      () => pep_screeningService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
