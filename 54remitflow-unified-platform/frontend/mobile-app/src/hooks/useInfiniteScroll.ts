import { useState } from 'react';
export const useInfiniteScroll = (fetchFn: any) => {
  const [data, setData] = useState<any[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const loadMore = async () => {
    if (loading) return;
    setLoading(true);
    const newData = await fetchFn(page);
    setData([...data, ...newData]);
    setPage(page + 1);
    setLoading(false);
  };
  return { data, loading, loadMore };
};