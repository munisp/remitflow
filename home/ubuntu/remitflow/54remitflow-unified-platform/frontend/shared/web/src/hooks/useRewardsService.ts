import { useMutation, useQuery, useQueryClient } from 'react-query';
import { rewardsService } from '../api/services/rewardsService';

export const useRewardsService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    rewardsService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('rewards');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['rewards', id],
      () => rewardsService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['rewards', page, pageSize],
      () => rewardsService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
