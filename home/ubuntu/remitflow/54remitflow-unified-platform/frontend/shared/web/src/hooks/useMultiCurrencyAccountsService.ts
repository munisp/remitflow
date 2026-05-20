import { useMutation, useQuery, useQueryClient } from 'react-query';
import { multi_currency_accountsService } from '../api/services/multi_currency_accountsService';

export const useMultiCurrencyAccountsService = () => {
  const queryClient = useQueryClient();

  const create = useMutation(
    multi_currency_accountsService.create,
    {
      onSuccess: () => {
        queryClient.invalidateQueries('multi-currency-accounts');
      }
    }
  );

  const useItem = (id: string) => {
    return useQuery(
      ['multi-currency-accounts', id],
      () => multi_currency_accountsService.get(id),
      { enabled: !!id }
    );
  };

  const useList = (page: number, pageSize: number) => {
    return useQuery(
      ['multi-currency-accounts', page, pageSize],
      () => multi_currency_accountsService.list(page, pageSize)
    );
  };

  return {
    create: create.mutateAsync,
    useItem,
    useList
  };
};
