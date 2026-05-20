"""
Rate Limiting Middleware for PIX Integration Service
Protects against brute force attacks and API abuse
"""

import time
import logging
from typing import Dict, Tuple, Optional
from datetime import datetime, timedelta
from collections import defaultdict
from fastapi import Request, HTTPException, status
from fastapi.responses import JSONResponse
import asyncio

logger = logging.getLogger(__name__)


class RateLimiter:
    """
    In-memory rate limiter with sliding window algorithm
    
    For production with multiple servers, use Redis-based rate limiting
    """
    
    def __init__(
        self,
        requests_per_minute: int = 5,
        requests_per_hour: int = 20,
        ban_duration_minutes: int = 60
    ):
        """
        Initialize rate limiter
        
        Args:
            requests_per_minute: Maximum requests allowed per minute
            requests_per_hour: Maximum requests allowed per hour
            ban_duration_minutes: Duration to ban IP after exceeding limits
        """
        self.requests_per_minute = requests_per_minute
        self.requests_per_hour = requests_per_hour
        self.ban_duration = timedelta(minutes=ban_duration_minutes)
        
        # Storage: {ip_address: [(timestamp, endpoint), ...]}
        self.request_history: Dict[str, list] = defaultdict(list)
        
        # Banned IPs: {ip_address: ban_expiry_timestamp}
        self.banned_ips: Dict[str, datetime] = {}
        
        # Lock for thread safety
        self.lock = asyncio.Lock()
        
        logger.info(
            f"Rate limiter initialized: {requests_per_minute}/min, "
            f"{requests_per_hour}/hour, ban={ban_duration_minutes}min"
        )
    
    async def cleanup_old_requests(self):
        """Remove request history older than 1 hour"""
        async with self.lock:
            cutoff_time = time.time() - 3600  # 1 hour ago
            
            for ip in list(self.request_history.keys()):
                # Filter out old requests
                self.request_history[ip] = [
                    (ts, endpoint) 
                    for ts, endpoint in self.request_history[ip]
                    if ts > cutoff_time
                ]
                
                # Remove IP if no recent requests
                if not self.request_history[ip]:
                    del self.request_history[ip]
            
            # Remove expired bans
            current_time = datetime.utcnow()
            self.banned_ips = {
                ip: expiry 
                for ip, expiry in self.banned_ips.items()
                if expiry > current_time
            }
    
    def get_client_ip(self, request: Request) -> str:
        """
        Extract client IP address from request
        
        Handles X-Forwarded-For header for proxied requests
        
        Args:
            request: FastAPI request object
            
        Returns:
            Client IP address
        """
        # Check X-Forwarded-For header (for proxied requests)
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            # Take the first IP in the chain
            return forwarded_for.split(",")[0].strip()
        
        # Check X-Real-IP header
        real_ip = request.headers.get("X-Real-IP")
        if real_ip:
            return real_ip.strip()
        
        # Fall back to direct client IP
        if request.client:
            return request.client.host
        
        return "unknown"
    
    async def is_rate_limited(
        self,
        request: Request,
        endpoint: str = "default"
    ) -> Tuple[bool, Optional[str]]:
        """
        Check if request should be rate limited
        
        Args:
            request: FastAPI request object
            endpoint: Endpoint identifier for tracking
            
        Returns:
            Tuple of (is_limited, reason)
        """
        ip_address = self.get_client_ip(request)
        current_time = time.time()
        current_datetime = datetime.utcnow()
        
        async with self.lock:
            # Check if IP is banned
            if ip_address in self.banned_ips:
                ban_expiry = self.banned_ips[ip_address]
                if ban_expiry > current_datetime:
                    remaining = int((ban_expiry - current_datetime).total_seconds())
                    logger.warning(
                        f"Blocked banned IP {ip_address} on {endpoint}. "
                        f"Ban expires in {remaining}s"
                    )
                    return True, f"IP banned for {remaining} seconds due to excessive requests"
                else:
                    # Ban expired, remove it
                    del self.banned_ips[ip_address]
            
            # Get request history for this IP
            history = self.request_history[ip_address]
            
            # Count requests in last minute
            minute_ago = current_time - 60
            requests_last_minute = sum(
                1 for ts, _ in history if ts > minute_ago
            )
            
            # Count requests in last hour
            hour_ago = current_time - 3600
            requests_last_hour = sum(
                1 for ts, _ in history if ts > hour_ago
            )
            
            # Check minute limit
            if requests_last_minute >= self.requests_per_minute:
                logger.warning(
                    f"Rate limit exceeded for {ip_address} on {endpoint}: "
                    f"{requests_last_minute} requests in last minute"
                )
                
                # Ban IP if severely exceeding limits
                if requests_last_minute >= self.requests_per_minute * 2:
                    self.banned_ips[ip_address] = current_datetime + self.ban_duration
                    logger.error(f"IP {ip_address} banned for {self.ban_duration}")
                    return True, f"IP banned for {self.ban_duration.total_seconds()/60:.0f} minutes"
                
                return True, f"Rate limit: {self.requests_per_minute} requests per minute"
            
            # Check hour limit
            if requests_last_hour >= self.requests_per_hour:
                logger.warning(
                    f"Hourly rate limit exceeded for {ip_address} on {endpoint}: "
                    f"{requests_last_hour} requests in last hour"
                )
                return True, f"Rate limit: {self.requests_per_hour} requests per hour"
            
            # Record this request
            history.append((current_time, endpoint))
            
            logger.debug(
                f"Request allowed for {ip_address} on {endpoint}: "
                f"{requests_last_minute + 1}/{self.requests_per_minute} per minute, "
                f"{requests_last_hour + 1}/{self.requests_per_hour} per hour"
            )
            
            return False, None
    
    async def check_rate_limit(
        self,
        request: Request,
        endpoint: str = "default"
    ):
        """
        Check rate limit and raise HTTPException if exceeded
        
        Use as FastAPI dependency
        
        Args:
            request: FastAPI request object
            endpoint: Endpoint identifier
            
        Raises:
            HTTPException: If rate limit exceeded
        """
        is_limited, reason = await self.is_rate_limited(request, endpoint)
        
        if is_limited:
            ip_address = self.get_client_ip(request)
            logger.warning(f"Rate limit exceeded for {ip_address}: {reason}")
            
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "Rate limit exceeded",
                    "message": reason,
                    "ip_address": ip_address,
                    "retry_after": 60  # seconds
                },
                headers={"Retry-After": "60"}
            )
    
    def get_stats(self, ip_address: Optional[str] = None) -> dict:
        """
        Get rate limiter statistics
        
        Args:
            ip_address: Optional IP to get specific stats for
            
        Returns:
            Dictionary with statistics
        """
        if ip_address:
            history = self.request_history.get(ip_address, [])
            current_time = time.time()
            
            requests_last_minute = sum(
                1 for ts, _ in history if ts > current_time - 60
            )
            requests_last_hour = sum(
                1 for ts, _ in history if ts > current_time - 3600
            )
            
            is_banned = ip_address in self.banned_ips
            ban_expiry = self.banned_ips.get(ip_address)
            
            return {
                "ip_address": ip_address,
                "requests_last_minute": requests_last_minute,
                "requests_last_hour": requests_last_hour,
                "is_banned": is_banned,
                "ban_expiry": ban_expiry.isoformat() if ban_expiry else None,
                "limit_per_minute": self.requests_per_minute,
                "limit_per_hour": self.requests_per_hour
            }
        else:
            return {
                "total_tracked_ips": len(self.request_history),
                "total_banned_ips": len(self.banned_ips),
                "limit_per_minute": self.requests_per_minute,
                "limit_per_hour": self.requests_per_hour,
                "ban_duration_minutes": self.ban_duration.total_seconds() / 60
            }


# Global rate limiter instances
login_rate_limiter = RateLimiter(
    requests_per_minute=5,   # 5 login attempts per minute
    requests_per_hour=20,    # 20 login attempts per hour
    ban_duration_minutes=60  # Ban for 1 hour if exceeded
)

api_rate_limiter = RateLimiter(
    requests_per_minute=60,   # 60 API requests per minute
    requests_per_hour=1000,   # 1000 API requests per hour
    ban_duration_minutes=30   # Ban for 30 minutes if exceeded
)


# Dependency functions for FastAPI
async def rate_limit_login(request: Request):
    """Rate limit dependency for login endpoint"""
    await login_rate_limiter.check_rate_limit(request, "login")


async def rate_limit_api(request: Request):
    """Rate limit dependency for general API endpoints"""
    await api_rate_limiter.check_rate_limit(request, "api")


# Background task to cleanup old data
async def cleanup_rate_limiters():
    """Background task to periodically cleanup old request history"""
    while True:
        await asyncio.sleep(300)  # Run every 5 minutes
        await login_rate_limiter.cleanup_old_requests()
        await api_rate_limiter.cleanup_old_requests()
        logger.debug("Rate limiter cleanup completed")
