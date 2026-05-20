import { useMutation, useQuery, useQueryClient } from 'react-query';
import { face_verificationService } from '../api/services/face_verificationService';

export const useFaceVerificationService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    face_verificationService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('face-verification');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['face-verification', id],
      () => face_verificationService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['face-verification', page, pageSize],
      () => face_verificationService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
