/*!
 * RemitFlow Social Sharing Link Generator
 * Built with Axum + Tokio + Serde
 * Port: 8085
 *
 * Generates short, signed, shareable links for community funds, talent profiles,
 * marketplace listings, and diaspora collectives. Links are public (no auth required)
 * and include Open Graph metadata for rich social previews.
 *
 * Endpoints:
 *   GET  /health
 *   POST /generate          — create a new share link
 *   GET  /resolve/:slug     — resolve slug → original URL + metadata
 *   GET  /og/:slug          — Open Graph HTML preview page
 *   GET  /stats/:slug       — click/view stats for a link
 *   POST /track/:slug       — record a click/view event
 *   GET  /list              — list all active links (internal)
 */

use axum::{
    extract::{Path, Json, State},
    http::StatusCode,
    response::{Html, IntoResponse},
    routing::{get, post},
    Router,
};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    net::SocketAddr,
    sync::{Arc, RwLock},
};
use tower_http::cors::{Any, CorsLayer};
use tracing::{info, warn};
use uuid::Uuid;

// ─── Types ────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShareLink {
    pub id: String,
    pub slug: String,
    pub resource_type: String, // "fund" | "talent" | "listing" | "collective" | "referral"
    pub resource_id: String,
    pub title: String,
    pub description: String,
    pub image_url: Option<String>,
    pub target_url: String,
    pub base_url: String,
    pub short_url: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: Option<DateTime<Utc>>,
    pub clicks: u64,
    pub views: u64,
    pub is_active: bool,
    pub created_by: Option<String>,
    pub metadata: HashMap<String, serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub struct GenerateRequest {
    pub resource_type: String,
    pub resource_id: String,
    pub title: String,
    pub description: String,
    pub image_url: Option<String>,
    pub target_url: String,
    pub base_url: Option<String>,
    pub expires_in_days: Option<i64>,
    pub created_by: Option<String>,
    pub metadata: Option<HashMap<String, serde_json::Value>>,
}

#[derive(Debug, Serialize)]
pub struct GenerateResponse {
    pub id: String,
    pub slug: String,
    pub short_url: String,
    pub og_url: String,
    pub share_urls: ShareUrls,
    pub expires_at: Option<DateTime<Utc>>,
}

#[derive(Debug, Serialize)]
pub struct ShareUrls {
    pub whatsapp: String,
    pub twitter: String,
    pub facebook: String,
    pub telegram: String,
    pub copy: String,
}

#[derive(Debug, Serialize)]
pub struct ResolveResponse {
    pub found: bool,
    pub link: Option<ShareLink>,
    pub redirect_url: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct StatsResponse {
    pub slug: String,
    pub clicks: u64,
    pub views: u64,
    pub created_at: Option<DateTime<Utc>>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
pub struct TrackRequest {
    pub event_type: String, // "click" | "view"
    pub referrer: Option<String>,
    pub user_agent: Option<String>,
}

// ─── State ────────────────────────────────────────────────────────────────────

type SharedState = Arc<RwLock<AppState>>;

struct AppState {
    links: HashMap<String, ShareLink>, // slug → ShareLink
    start_time: DateTime<Utc>,
}

impl AppState {
    fn new() -> Self {
        let mut state = AppState {
            links: HashMap::new(),
            start_time: Utc::now(),
        };
        // Seed with demo share links
        state.seed_demo_links();
        state
    }

    fn seed_demo_links(&mut self) {
        let demos = vec![
            ("fund", "fund-001", "Lagos School Building Fund", "Help us build a new primary school in Lagos Island. Every contribution counts!", "https://images.unsplash.com/photo-1580582932707-520aed937b7b?w=800", "https://remitflow.manus.space/community?tab=funds&id=fund-001"),
            ("collective", "col-001", "West Africa Tech Collective", "Join 847 diaspora members investing in West Africa's tech ecosystem.", "https://images.unsplash.com/photo-1504384308090-c894fdcc538d?w=800", "https://remitflow.manus.space/diaspora-invest?id=col-001"),
            ("listing", "lst-001", "Premium Ankara Fabric Collection", "Handwoven authentic Ankara fabric from Kano artisans. Ships worldwide.", "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800", "https://remitflow.manus.space/afrimarket?listing=lst-001"),
            ("talent", "tal-001", "Dr. Amara Osei — Fintech Consultant", "10+ years in cross-border payments. Available for advisory sessions.", "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?w=800", "https://remitflow.manus.space/talent-bridge?profile=tal-001"),
        ];

        for (rtype, rid, title, desc, img, url) in demos {
            let slug = generate_slug(rtype, rid);
            let base_url = "https://remitflow.manus.space";
            let short_url = format!("{}/share/{}", base_url, slug);
            let link = ShareLink {
                id: Uuid::new_v4().to_string(),
                slug: slug.clone(),
                resource_type: rtype.to_string(),
                resource_id: rid.to_string(),
                title: title.to_string(),
                description: desc.to_string(),
                image_url: Some(img.to_string()),
                target_url: url.to_string(),
                base_url: base_url.to_string(),
                short_url,
                created_at: Utc::now(),
                expires_at: None,
                clicks: rand_u64(10, 500),
                views: rand_u64(100, 5000),
                is_active: true,
                created_by: Some("system".to_string()),
                metadata: HashMap::new(),
            };
            self.links.insert(slug, link);
        }
    }
}

fn rand_u64(min: u64, max: u64) -> u64 {
    // Simple deterministic pseudo-random for seeding
    let t = Utc::now().timestamp_nanos_opt().unwrap_or(0) as u64;
    min + (t % (max - min))
}

// ─── Slug generation ──────────────────────────────────────────────────────────

fn generate_slug(resource_type: &str, resource_id: &str) -> String {
    let input = format!("{}-{}-{}", resource_type, resource_id, Uuid::new_v4());
    let hash = Sha256::digest(input.as_bytes());
    let hex = hex::encode(&hash[..4]); // 8 hex chars = 4 bytes
    format!("{}-{}", &resource_type[..3.min(resource_type.len())], hex)
}

// ─── Share URL builders ───────────────────────────────────────────────────────

fn build_share_urls(short_url: &str, title: &str) -> ShareUrls {
    let encoded_url = urlencoding::encode(short_url).to_string();
    let encoded_title = urlencoding::encode(title).to_string();

    ShareUrls {
        whatsapp: format!(
            "https://wa.me/?text={}%20{}",
            encoded_title, encoded_url
        ),
        twitter: format!(
            "https://twitter.com/intent/tweet?text={}&url={}",
            encoded_title, encoded_url
        ),
        facebook: format!(
            "https://www.facebook.com/sharer/sharer.php?u={}",
            encoded_url
        ),
        telegram: format!(
            "https://t.me/share/url?url={}&text={}",
            encoded_url, encoded_title
        ),
        copy: short_url.to_string(),
    }
}

// ─── Open Graph HTML ──────────────────────────────────────────────────────────

fn build_og_html(link: &ShareLink) -> String {
    let image = link
        .image_url
        .as_deref()
        .unwrap_or("https://remitflow.manus.space/og-default.png");

    format!(
        r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>{title}</title>
  <!-- Open Graph -->
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{desc}">
  <meta property="og:image" content="{image}">
  <meta property="og:url" content="{url}">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="RemitFlow">
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="{title}">
  <meta name="twitter:description" content="{desc}">
  <meta name="twitter:image" content="{image}">
  <!-- Redirect -->
  <meta http-equiv="refresh" content="0; url={target}">
  <style>
    body {{ font-family: -apple-system, sans-serif; display: flex; align-items: center;
           justify-content: center; min-height: 100vh; margin: 0; background: #0f172a; color: #f1f5f9; }}
    .card {{ max-width: 480px; text-align: center; padding: 2rem; }}
    img {{ width: 100%; border-radius: 12px; margin-bottom: 1rem; }}
    h1 {{ font-size: 1.5rem; margin: 0 0 0.5rem; }}
    p {{ color: #94a3b8; margin: 0 0 1.5rem; }}
    a {{ background: #6366f1; color: white; padding: 0.75rem 2rem;
         border-radius: 8px; text-decoration: none; font-weight: 600; }}
  </style>
</head>
<body>
  <div class="card">
    <img src="{image}" alt="{title}" onerror="this.style.display='none'">
    <h1>{title}</h1>
    <p>{desc}</p>
    <a href="{target}">Open in RemitFlow →</a>
  </div>
</body>
</html>"#,
        title = link.title,
        desc = link.description,
        image = image,
        url = link.short_url,
        target = link.target_url,
    )
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async fn health(State(state): State<SharedState>) -> impl IntoResponse {
    let s = state.read().unwrap();
    let uptime = (Utc::now() - s.start_time).num_seconds();
    Json(serde_json::json!({
        "status": "ok",
        "service": "rust-share-link",
        "version": "1.0.0",
        "links_stored": s.links.len(),
        "uptime_seconds": uptime,
    }))
}

async fn generate(
    State(state): State<SharedState>,
    Json(req): Json<GenerateRequest>,
) -> impl IntoResponse {
    let slug = generate_slug(&req.resource_type, &req.resource_id);
    let base_url = req
        .base_url
        .clone()
        .unwrap_or_else(|| "https://remitflow.manus.space".to_string());
    let short_url = format!("{}/share/{}", base_url, slug);
    let og_url = format!("{}/og/{}", base_url, slug);

    let expires_at = req.expires_in_days.map(|d| Utc::now() + Duration::days(d));

    let link = ShareLink {
        id: Uuid::new_v4().to_string(),
        slug: slug.clone(),
        resource_type: req.resource_type.clone(),
        resource_id: req.resource_id.clone(),
        title: req.title.clone(),
        description: req.description.clone(),
        image_url: req.image_url.clone(),
        target_url: req.target_url.clone(),
        base_url: base_url.clone(),
        short_url: short_url.clone(),
        created_at: Utc::now(),
        expires_at,
        clicks: 0,
        views: 0,
        is_active: true,
        created_by: req.created_by.clone(),
        metadata: req.metadata.clone().unwrap_or_default(),
    };

    let share_urls = build_share_urls(&short_url, &req.title);
    let response = GenerateResponse {
        id: link.id.clone(),
        slug: slug.clone(),
        short_url: short_url.clone(),
        og_url,
        share_urls,
        expires_at: link.expires_at,
    };

    {
        let mut s = state.write().unwrap();
        s.links.insert(slug.clone(), link);
    }

    info!("Generated share link: {} for {}/{}", slug, req.resource_type, req.resource_id);
    (StatusCode::CREATED, Json(response))
}

async fn resolve(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
) -> impl IntoResponse {
    let s = state.read().unwrap();
    match s.links.get(&slug) {
        Some(link) if link.is_active => {
            let expired = link
                .expires_at
                .map(|exp| Utc::now() > exp)
                .unwrap_or(false);
            if expired {
                return Json(ResolveResponse {
                    found: false,
                    link: None,
                    redirect_url: None,
                });
            }
            Json(ResolveResponse {
                found: true,
                redirect_url: Some(link.target_url.clone()),
                link: Some(link.clone()),
            })
        }
        _ => Json(ResolveResponse {
            found: false,
            link: None,
            redirect_url: None,
        }),
    }
}

async fn og_page(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
) -> impl IntoResponse {
    let s = state.read().unwrap();
    match s.links.get(&slug) {
        Some(link) => Html(build_og_html(link)),
        None => Html("<html><body><h1>Link not found</h1></body></html>".to_string()),
    }
}

async fn stats(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
) -> impl IntoResponse {
    let s = state.read().unwrap();
    match s.links.get(&slug) {
        Some(link) => Json(StatsResponse {
            slug: link.slug.clone(),
            clicks: link.clicks,
            views: link.views,
            created_at: Some(link.created_at),
            is_active: link.is_active,
        }),
        None => Json(StatsResponse {
            slug,
            clicks: 0,
            views: 0,
            created_at: None,
            is_active: false,
        }),
    }
}

async fn track(
    State(state): State<SharedState>,
    Path(slug): Path<String>,
    Json(req): Json<TrackRequest>,
) -> impl IntoResponse {
    let mut s = state.write().unwrap();
    if let Some(link) = s.links.get_mut(&slug) {
        match req.event_type.as_str() {
            "click" => link.clicks += 1,
            "view" => link.views += 1,
            _ => {}
        }
        info!("Tracked {} on slug: {}", req.event_type, slug);
        return Json(serde_json::json!({ "ok": true, "clicks": link.clicks, "views": link.views }));
    }
    warn!("Track: slug not found: {}", slug);
    Json(serde_json::json!({ "ok": false, "error": "not found" }))
}

async fn list_links(State(state): State<SharedState>) -> impl IntoResponse {
    let s = state.read().unwrap();
    let links: Vec<&ShareLink> = s.links.values().filter(|l| l.is_active).collect();
    Json(serde_json::json!({
        "links": links,
        "count": links.len(),
    }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            std::env::var("RUST_LOG").unwrap_or_else(|_| "info".to_string()),
        )
        .init();

    let port: u16 = std::env::var("PORT")
        .unwrap_or_else(|_| "8085".to_string())
        .parse()
        .unwrap_or(8085);

    let state: SharedState = Arc::new(RwLock::new(AppState::new()));

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        .route("/health", get(health))
        .route("/generate", post(generate))
        .route("/resolve/:slug", get(resolve))
        .route("/og/:slug", get(og_page))
        .route("/stats/:slug", get(stats))
        .route("/track/:slug", post(track))
        .route("/list", get(list_links))
        .layer(cors)
        .with_state(state);

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    info!("[ShareLink] Starting on port {}", port);

    let listener = tokio::net::TcpListener::bind(addr).await.unwrap();
    axum::serve(listener, app).await.unwrap();
}
