import React from 'react';
import { useQuery } from 'react-query';
import { get } from '../../web/src/api/apiService';

const DisputesList: React.FC = () => {
  const { data, error, isLoading } = useQuery('disputes', () => get('/api/disputes'));

  if (isLoading) return <div>Loading disputes...</div>;
  if (error) return <div>An error occurred while fetching disputes.</div>;

  return (
    <div className='p-4 border rounded-lg'>
      <h2 className='text-xl font-bold mb-4'>Disputes List</h2>
      {data && data.length > 0 ? (
        <ul>
          {data.map((dispute: any) => (
            <li key={dispute.id} className='border-b py-2'>
              <p><strong>ID:</strong> {dispute.id}</p>
              <p><strong>Status:</strong> {dispute.status}</p>
              <p><strong>Reason:</strong> {dispute.reason}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p>No disputes found.</p>
      )}
    </div>
  );
};

export default DisputesList;
