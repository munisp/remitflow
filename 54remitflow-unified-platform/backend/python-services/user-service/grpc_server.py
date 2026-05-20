
import grpc
from concurrent import futures
import time
import user_service_pb2
import user_service_pb2_grpc
import asyncpg
import os
import uuid
from google.protobuf.timestamp_pb2 import Timestamp
from google.protobuf.empty_pb2 import Empty

DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://remittance:remittance@localhost:5432/remittance")

class UserServiceServicer(user_service_pb2_grpc.UserServiceServicer):
    def __init__(self, db_pool):
        self.db_pool = db_pool

    async def CreateUserProfile(self, request, context):
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow(
                """INSERT INTO user_profiles (email, phone, full_name, date_of_birth, country, address, kyc_level, status, preferred_currency, language)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *""",
                request.email, request.phone, request.full_name, request.date_of_birth, request.country, request.address, request.kyc_level, request.status, request.preferred_currency, request.language
            )
            return self._to_user_profile_response(row)

    async def GetUserProfile(self, request, context):
        async with self.db_pool.acquire() as conn:
            row = await conn.fetchrow("SELECT * FROM user_profiles WHERE id=$1", uuid.UUID(request.user_id))
            if not row:
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details("User not found")
                return user_service_pb2.UserProfileResponse()
            return self._to_user_profile_response(row)

    async def UpdateUserProfile(self, request, context):
        async with self.db_pool.acquire() as conn:
            # Similar logic to the REST endpoint, but adapted for gRPC
            pass # Implementation omitted for brevity

    async def DeleteUserProfile(self, request, context):
        async with self.db_pool.acquire() as conn:
            result = await conn.execute("DELETE FROM user_profiles WHERE id=$1", uuid.UUID(request.user_id))
            if result == "DELETE 0":
                context.set_code(grpc.StatusCode.NOT_FOUND)
                context.set_details("User not found")
                return Empty()
            return Empty()

    async def ListUserProfiles(self, request, context):
        async with self.db_pool.acquire() as conn:
            rows = await conn.fetch("SELECT * FROM user_profiles ORDER BY created_at DESC LIMIT $1 OFFSET $2", request.limit, request.skip)
            total = await conn.fetchval("SELECT COUNT(*) FROM user_profiles")
            items = [self._to_user_profile_response(row) for row in rows]
            return user_service_pb2.ListUserProfilesResponse(total=total, items=items, skip=request.skip, limit=request.limit)

    async def GetUserStats(self, request, context):
        async with self.db_pool.acquire() as conn:
            total = await conn.fetchval("SELECT COUNT(*) FROM user_profiles")
            today = await conn.fetchval("SELECT COUNT(*) FROM user_profiles WHERE created_at >= CURRENT_DATE")
            return user_service_pb2.UserStatsResponse(total=total, today=today)

    def _to_user_profile_response(self, row):
        response = user_service_pb2.UserProfileResponse()
        for key, value in row.items():
            if value is not None:
                if isinstance(value, datetime.datetime):
                    ts = Timestamp()
                    ts.FromDatetime(value)
                    setattr(response, key, ts)
                else:
                    setattr(response, key, value)
        return response

async def serve():
    server = grpc.aio.server(futures.ThreadPoolExecutor(max_workers=10))
    db_pool = await asyncpg.create_pool(DATABASE_URL, min_size=2, max_size=10)
    user_service_pb2_grpc.add_UserServiceServicer_to_server(UserServiceServicer(db_pool), server)
    server.add_insecure_port("[::]:50051")
    await server.start()
    print("Server started on port 50051")
    await server.wait_for_termination()

if __name__ == "__main__":
    import asyncio
    asyncio.run(serve())
