import { useMutation, useQuery, useQueryClient } from 'react-query';
import { payment_processingService } from '../api/services/payment_processingService';

export const usePaymentProcessingService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    payment_processingService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('payment-processing');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['payment-processing', id],
      () => payment_processingService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['payment-processing', page, pageSize],
      () => payment_processingService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
