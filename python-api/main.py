"""
FastAPI Backend for GitHub Repository Analysis using Gemini AI
Analyzes repositories for contributor insights, code ownership, and sustainability metrics
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import httpx
import os
from collections import defaultdict
from datetime import datetime, timezone
import asyncio
import json
import re

app = FastAPI(title="GitHub Repository Analyzer")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-1.5-flash")
GEMINI_API_URL = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
analysis_cache = {}
analysis_jobs = {}

class AnalysisRequest(BaseModel):
    github_url: str
    workspace_id: Optional[str] = None
    max_commits: Optional[int] = 1000
    deep_analysis: Optional[bool] = True

class FileContribution(BaseModel):
    file_path: str
    lines_contributed: int
    total_lines: int
    ownership_percentage: float
    last_modified: str
    commits_count: int
    file_type: str

class ContributorAnalysis(BaseModel):
    username: str
    email: str
    total_commits: int
    files_contributed: List[FileContribution]
    knowledge_areas: List[str]
    expertise_level: str
    contribution_summary: str
    bus_factor_risk: str
    lines_added: int
    lines_deleted: int
    first_commit_date: str
    last_commit_date: str
    active_days: int
    commit_frequency: float

class StaleFile(BaseModel):
    file_path: str
    last_modified: str
    days_since_modified: int
    last_contributor: str
    risk_level: str

class HotSpot(BaseModel):
    file_path: str
    commit_count: int
    contributor_count: int
    last_modified: str
    change_frequency: str

class CodebaseHealth(BaseModel):
    total_files: int
    total_commits: int
    active_contributors: int
    stale_files: List[StaleFile]
    hot_spots: List[HotSpot]
    maintenance_concerns: List[str]
    code_concentration: Dict[str, float]
    overall_bus_factor: int
    risk_assessment: str
    knowledge_distribution: Dict[str, int]

class AnalysisResponse(BaseModel):
    workspace_id: str
    repository_name: str
    repository_url: str
    project_summary: str
    primary_languages: List[str]
    contributors: List[ContributorAnalysis]
    codebase_health: CodebaseHealth
    recommendations: List[str]
    analysis_timestamp: str
    metadata: Dict[str, Any]

class AnalysisStatus(BaseModel):
    workspace_id: str
    status: str
    progress: int
    message: str
    current_step: str
    estimated_time_remaining: Optional[int] = None

def get_github_headers():
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "GitHub-Analyzer/1.0"
    }
    if GITHUB_TOKEN:
        headers["Authorization"] = f"token {GITHUB_TOKEN}"
    return headers

async def fetch_github_data(url: str, params: Dict = None) -> Any:
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                url,
                headers=get_github_headers(),
                params=params,
                timeout=30.0
            )
            if response.status_code == 404:
                raise HTTPException(status_code=404, detail="Resource not found")
            if response.status_code == 403:
                raise HTTPException(status_code=403, detail="Rate limit exceeded. Add GITHUB_TOKEN to env")
            response.raise_for_status()
            return response.json()
        except httpx.TimeoutException:
            raise HTTPException(status_code=504, detail="GitHub API timeout")

async def fetch_repo_info(owner: str, repo: str) -> Dict:
    return await fetch_github_data(f"https://api.github.com/repos/{owner}/{repo}")

async def fetch_all_commits(owner: str, repo: str, max_commits: int) -> List[Dict]:
    commits = []
    page = 1
    per_page = 100
    while len(commits) < max_commits:
        batch = await fetch_github_data(
            f"https://api.github.com/repos/{owner}/{repo}/commits",
            {"page": page, "per_page": per_page}
        )
        if not batch:
            break
        commits.extend(batch)
        if len(batch) < per_page:
            break
        page += 1
    return commits[:max_commits]

async def fetch_commit_details(owner: str, repo: str, sha: str) -> Dict:
    return await fetch_github_data(
        f"https://api.github.com/repos/{owner}/{repo}/commits/{sha}"
    )

async def fetch_file_content(owner: str, repo: str, path: str, ref: str = "main") -> Optional[str]:
    try:
        data = await fetch_github_data(
            f"https://api.github.com/repos/{owner}/{repo}/contents/{path}",
            {"ref": ref}
        )
        if isinstance(data, dict) and data.get('type') == 'file':
            import base64
            content = base64.b64decode(data['content']).decode('utf-8', errors='ignore')
            return content
    except:
        return None

async def fetch_repo_languages(owner: str, repo: str) -> Dict[str, int]:
    return await fetch_github_data(f"https://api.github.com/repos/{owner}/{repo}/languages")

async def call_gemini(prompt: str, temperature: float = 0.3, max_retries: int = 3) -> str:
    """Call Gemini API with retry logic"""
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY not set")
    
    payload = {
        "contents": [{
            "parts": [{"text": prompt}]
        }],
        "generationConfig": {
            "temperature": temperature,
            "maxOutputTokens": 8192,
        }
    }
    
    for attempt in range(max_retries):
        try:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    f"{GEMINI_API_URL}?key={GEMINI_API_KEY}",
                    json=payload,
                    timeout=60.0
                )
                
                if response.status_code == 200:
                    result = response.json()
                    return result["candidates"][0]["content"]["parts"][0]["text"]
                
                if response.status_code == 429:
                    error_data = response.json()
                    retry_after = 15  # Default wait time
                    
                    if "error" in error_data and "details" in error_data["error"]:
                        for detail in error_data["error"]["details"]:
                            if detail.get("@type") == "type.googleapis.com/google.rpc.RetryInfo":
                                retry_delay = detail.get("retryDelay", "15s")
                                retry_after = int(retry_delay.rstrip('s'))
                                break
                    
                    if attempt < max_retries - 1:
                        wait_time = retry_after + (attempt * 5)  # Exponential backoff
                        print(f"Rate limited. Waiting {wait_time}s before retry {attempt + 1}/{max_retries}")
                        await asyncio.sleep(wait_time)
                        continue
                    else:
                        raise HTTPException(
                            status_code=429,
                            detail=f"Gemini API rate limit exceeded. Please wait {retry_after} seconds and try again."
                        )
                
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"Gemini API error: {response.text}"
                )
                
        except httpx.TimeoutException:
            if attempt < max_retries - 1:
                wait_time = (attempt + 1) * 5
                print(f"Timeout. Retrying in {wait_time}s...")
                await asyncio.sleep(wait_time)
                continue
            raise HTTPException(status_code=504, detail="Gemini API timeout after retries")
    
    raise HTTPException(status_code=500, detail="Failed to call Gemini API after retries")

def extract_json(text: str) -> Dict:
    """Extract JSON from Gemini response"""
    try:
        text = re.sub(r'```json\s*', '', text)
        text = re.sub(r'```\s*', '', text)
        text = text.strip()
        return json.loads(text)
    except json.JSONDecodeError:
        json_match = re.search(r'\{[\s\S]*\}', text)
        if json_match:
            try:
                return json.loads(json_match.group())
            except:
                pass
        return {}

async def analyze_project_with_ai(repo_info: Dict, languages: Dict, file_structure: List[str]) -> str:
    """Generate project summary using Gemini"""
    
    file_sample = "\n".join(file_structure[:50])
    
    prompt = f"""Analyze this GitHub repository and provide a comprehensive project summary.

Repository: {repo_info['full_name']}
Description: {repo_info.get('description', 'No description provided')}
Primary Language: {repo_info.get('language', 'Unknown')}
Stars: {repo_info.get('stargazers_count', 0)}
Forks: {repo_info.get('forks_count', 0)}
Created: {repo_info.get('created_at', 'Unknown')}
Last Updated: {repo_info.get('updated_at', 'Unknown')}

Languages Used:
{json.dumps(languages, indent=2)}

File Structure Sample:
{file_sample}

Provide a detailed summary (3-4 paragraphs) covering:
1. What this project does and its purpose
2. Technical architecture and tech stack
3. Key features and functionality
4. Target use case and audience

Be specific and technical. Focus on what makes this project unique."""

    try:
        return await call_gemini(prompt)
    except Exception as e:
        print(f"AI summary failed: {str(e)}")
        return f"{repo_info['full_name']}: {repo_info.get('description', 'A software project')}. Primary language: {repo_info.get('language', 'Unknown')}. This repository has {repo_info.get('stargazers_count', 0)} stars and {repo_info.get('forks_count', 0)} forks."

async def analyze_contributor_with_ai(
    username: str,
    total_commits: int,
    files_worked: List[Dict],
    commit_messages: List[str],
    date_range: tuple
) -> Dict:
    """Analyze contributor knowledge using Gemini"""
    
    file_list = "\n".join([
        f"- {f['path']} ({f['commits']} commits, {f['changes']} changes)"
        for f in files_worked[:30]
    ])
    
    messages_sample = "\n".join([f"- {msg}" for msg in commit_messages[:20]])
    
    prompt = f"""Analyze this contributor's knowledge and role in the codebase.

Contributor: {username}
Total Commits: {total_commits}
Active Period: {date_range[0]} to {date_range[1]}
Files Modified: {len(files_worked)}

Files they've worked on:
{file_list}

Sample commit messages:
{messages_sample}

Return ONLY valid JSON with this exact structure:
{{
  "knowledge_areas": ["specific areas/modules they know well - be specific"],
  "expertise_level": "Core|Major|Minor",
  "contribution_summary": "2-3 sentences describing their main contributions",
  "bus_factor_risk": "Critical|High|Medium|Low"
}}

Guidelines:
- Core: 100+ commits, works across critical areas
- Major: 30-100 commits, significant contributions
- Minor: <30 commits, limited scope
- Critical risk: sole expert in critical areas
- High risk: primary expert in important areas
- Medium risk: knowledge shared with 1-2 others
- Low risk: work is well-distributed"""

    try:
        response = await call_gemini(prompt, temperature=0.2)
        result = extract_json(response)
        
        return {
            "knowledge_areas": result.get("knowledge_areas", ["General development"]),
            "expertise_level": result.get("expertise_level", "Minor"),
            "contribution_summary": result.get("contribution_summary", f"Contributed to {len(files_worked)} files"),
            "bus_factor_risk": result.get("bus_factor_risk", "Medium")
        }
    except Exception as e:
        print(f"AI analysis failed for {username}: {str(e)}")
        expertise = "Core" if total_commits > 100 else "Major" if total_commits > 30 else "Minor"
        risk = "High" if total_commits > 100 else "Medium" if total_commits > 30 else "Low"
        
        return {
            "knowledge_areas": [f"Contributed to {len(files_worked)} files"],
            "expertise_level": expertise,
            "contribution_summary": f"Made {total_commits} commits across various areas of the codebase",
            "bus_factor_risk": risk
        }

async def analyze_codebase_health_with_ai(
    total_files: int,
    total_commits: int,
    contributor_count: int,
    stale_file_count: int,
    hot_spot_count: int,
    knowledge_distribution: Dict[str, int]
) -> Dict:
    """Analyze overall codebase health"""
    
    prompt = f"""Analyze this codebase's health and sustainability for long-term maintenance.

Statistics:
- Total files: {total_files}
- Total commits: {total_commits}
- Active contributors: {contributor_count}
- Stale files (6+ months): {stale_file_count}
- Hot spots (frequently changed): {hot_spot_count}

Knowledge Distribution:
{json.dumps(knowledge_distribution, indent=2)}

Return ONLY valid JSON with this exact structure:
{{
  "maintenance_concerns": ["list 3-5 specific concerns"],
  "overall_bus_factor": number_between_1_and_10,
  "risk_assessment": "Low|Medium|High|Critical",
  "recommendations": ["list 5-7 actionable recommendations"]
}}

Bus Factor Scale:
1-2: Critical - Only 1-2 people know the codebase
3-4: High Risk - Small team, knowledge concentrated
5-7: Medium - Decent distribution but could improve
8-10: Low Risk - Well-distributed knowledge

Consider:
- Is knowledge centralized to few contributors?
- Are there abandoned areas of code?
- Is the team size adequate for the codebase size?
- Are there single points of failure?"""

    try:
        response = await call_gemini(prompt, temperature=0.2)
        result = extract_json(response)
        
        return {
            "maintenance_concerns": result.get("maintenance_concerns", ["Unable to analyze"]),
            "overall_bus_factor": result.get("overall_bus_factor", 3),
            "risk_assessment": result.get("risk_assessment", "Medium"),
            "recommendations": result.get("recommendations", ["Increase documentation", "Distribute knowledge"])
        }
    except Exception as e:
        print(f"Health analysis failed: {str(e)}")
        bus_factor = min(10, max(1, contributor_count // 2))
        risk = "Critical" if bus_factor <= 2 else "High" if bus_factor <= 4 else "Medium" if bus_factor <= 7 else "Low"
        
        return {
            "maintenance_concerns": [
                f"Repository has {contributor_count} active contributors",
                f"{stale_file_count} files haven't been updated in 6+ months" if stale_file_count > 0 else "No stale files detected",
                f"{hot_spot_count} files are frequently modified" if hot_spot_count > 0 else "Code changes are well-distributed"
            ],
            "overall_bus_factor": bus_factor,
            "risk_assessment": risk,
            "recommendations": [
                "Document critical code areas",
                "Cross-train team members on key components",
                "Regular code reviews to share knowledge",
                "Maintain updated README and contribution guides",
                "Monitor code ownership distribution"
            ]
        }

async def update_status(workspace_id: str, progress: int, message: str, step: str):
    """Update analysis status"""
    analysis_jobs[workspace_id] = AnalysisStatus(
        workspace_id=workspace_id,
        status="processing" if progress < 100 else "completed",
        progress=progress,
        message=message,
        current_step=step
    )

async def analyze_repository_full(
    github_url: str,
    workspace_id: str,
    max_commits: int,
    deep_analysis: bool
) -> AnalysisResponse:
    """Main analysis pipeline"""
    
    try:
        await update_status(workspace_id, 5, "Parsing repository URL...", "initialization")
        
        url_parts = github_url.rstrip('/').split('/')
        if len(url_parts) < 2:
            raise HTTPException(status_code=400, detail="Invalid GitHub URL")
        owner, repo = url_parts[-2], url_parts[-1]
        
        await update_status(workspace_id, 10, "Fetching repository information...", "repo_info")
        repo_info = await fetch_repo_info(owner, repo)
        
        await update_status(workspace_id, 15, "Analyzing languages...", "languages")
        languages = await fetch_repo_languages(owner, repo)
        
        await update_status(workspace_id, 20, "Fetching commit history...", "commits")
        commits = await fetch_all_commits(owner, repo, max_commits)
        
        if not commits:
            raise HTTPException(status_code=404, detail="No commits found in repository")
        
        await update_status(workspace_id, 30, "Analyzing contributors...", "contributors")
        
        contributor_data = defaultdict(lambda: {
            'commits': [],
            'files': defaultdict(lambda: {'commits': 0, 'changes': 0}),
            'lines_added': 0,
            'lines_deleted': 0,
            'messages': [],
            'emails': set()
        })
        
        file_metadata = defaultdict(lambda: {
            'contributors': set(),
            'commit_count': 0,
            'last_modified': None,
            'total_changes': 0
        })
        
        sample_rate = max(1, len(commits) // 100)
        
        for idx, commit in enumerate(commits):
            commit_data = commit.get('commit', {})
            author_info = commit.get('author') or {}
            author_name = author_info.get('login') or commit_data.get('author', {}).get('name', 'Unknown')
            author_email = commit_data.get('author', {}).get('email', 'unknown@example.com')
            
            contributor_data[author_name]['commits'].append(commit)
            contributor_data[author_name]['emails'].add(author_email)
            contributor_data[author_name]['messages'].append(
                commit_data.get('message', '')[:100]
            )
            
            if deep_analysis and idx % sample_rate == 0:
                try:
                    detailed = await fetch_commit_details(owner, repo, commit['sha'])
                    
                    for file in detailed.get('files', []):
                        file_path = file['filename']
                        changes = file.get('additions', 0) + file.get('deletions', 0)
                        
                        contributor_data[author_name]['files'][file_path]['commits'] += 1
                        contributor_data[author_name]['files'][file_path]['changes'] += changes
                        contributor_data[author_name]['lines_added'] += file.get('additions', 0)
                        contributor_data[author_name]['lines_deleted'] += file.get('deletions', 0)
                        
                        file_metadata[file_path]['contributors'].add(author_name)
                        file_metadata[file_path]['commit_count'] += 1
                        file_metadata[file_path]['total_changes'] += changes
                        
                        if not file_metadata[file_path]['last_modified']:
                            file_metadata[file_path]['last_modified'] = commit_data.get('author', {}).get('date')
                    
                    await asyncio.sleep(0.1)
                except:
                    pass
        
        all_files = list(file_metadata.keys())
        
        await update_status(workspace_id, 45, "Generating project summary...", "ai_summary")
        project_summary = await analyze_project_with_ai(repo_info, languages, all_files)
        
        await asyncio.sleep(2)
        
        await update_status(workspace_id, 50, "Analyzing contributor expertise...", "ai_contributors")
        
        contributors_analysis = []
        progress_per_contributor = 30 / max(len(contributor_data), 1)
        
        for idx, (username, data) in enumerate(contributor_data.items()):
            files_worked = [
                {'path': path, 'commits': info['commits'], 'changes': info['changes']}
                for path, info in data['files'].items()
            ]
            files_worked.sort(key=lambda x: x['commits'], reverse=True)
            
            dates = [c['commit']['author']['date'] for c in data['commits']]
            date_range = (min(dates), max(dates)) if dates else ("Unknown", "Unknown")
            
            ai_analysis = await analyze_contributor_with_ai(
                username,
                len(data['commits']),
                files_worked,
                data['messages'],
                date_range
            )
            
            file_contributions = []
            for file_info in files_worked[:20]:
                path = file_info['path']
                file_type = path.split('.')[-1] if '.' in path else 'unknown'
                
                total_commits_on_file = file_metadata[path]['commit_count']
                ownership = (file_info['commits'] / total_commits_on_file * 100) if total_commits_on_file > 0 else 0
                
                file_contributions.append(FileContribution(
                    file_path=path,
                    lines_contributed=file_info['changes'],
                    total_lines=file_metadata[path]['total_changes'],
                    ownership_percentage=round(ownership, 2),
                    last_modified=file_metadata[path]['last_modified'] or "Unknown",
                    commits_count=file_info['commits'],
                    file_type=file_type
                ))
            
            if dates:
                try:
                    first_date = datetime.fromisoformat(dates[-1].replace('Z', '+00:00'))
                    last_date = datetime.fromisoformat(dates[0].replace('Z', '+00:00'))
                    if first_date.tzinfo is None:
                        first_date = first_date.replace(tzinfo=timezone.utc)
                    if last_date.tzinfo is None:
                        last_date = last_date.replace(tzinfo=timezone.utc)
                    active_days = (last_date - first_date).days + 1
                    commit_frequency = len(data['commits']) / max(active_days, 1)
                except (ValueError, AttributeError) as e:
                    print(f"Date parsing error for {username}: {e}")
                    first_date = last_date = datetime.now(timezone.utc)
                    active_days = 0
                    commit_frequency = 0
            else:
                first_date = last_date = datetime.now(timezone.utc)
                active_days = 0
                commit_frequency = 0
            
            contributor_analysis = ContributorAnalysis(
                username=username,
                email=list(data['emails'])[0] if data['emails'] else "unknown@example.com",
                total_commits=len(data['commits']),
                files_contributed=file_contributions,
                knowledge_areas=ai_analysis['knowledge_areas'],
                expertise_level=ai_analysis['expertise_level'],
                contribution_summary=ai_analysis['contribution_summary'],
                bus_factor_risk=ai_analysis['bus_factor_risk'],
                lines_added=data['lines_added'],
                lines_deleted=data['lines_deleted'],
                first_commit_date=date_range[0],
                last_commit_date=date_range[1],
                active_days=active_days,
                commit_frequency=round(commit_frequency, 2)
            )
            
            contributors_analysis.append(contributor_analysis)
            
            await update_status(
                workspace_id,
                50 + int(progress_per_contributor * (idx + 1)),
                f"Analyzed {idx + 1}/{len(contributor_data)} contributors",
                "ai_contributors"
            )
            if idx < len(contributor_data) - 1:
                await asyncio.sleep(1.5)
        
        contributors_analysis.sort(key=lambda x: x.total_commits, reverse=True)
        
        await update_status(workspace_id, 85, "Identifying stale files...", "stale_files")
        
        stale_files = []
        now = datetime.now(timezone.utc)
        
        for file_path, metadata in file_metadata.items():
            if metadata['last_modified']:
                try:
                    last_mod = datetime.fromisoformat(metadata['last_modified'].replace('Z', '+00:00'))
                    if last_mod.tzinfo is None:
                        last_mod = last_mod.replace(tzinfo=timezone.utc)
                    days_since = (now - last_mod).days
                    if days_since > 180:
                        contributors_list = list(metadata['contributors'])
                        risk = "High" if days_since > 365 else "Medium"
                        stale_files.append(StaleFile(
                            file_path=file_path,
                            last_modified=metadata['last_modified'],
                            days_since_modified=days_since,
                            last_contributor=contributors_list[0] if contributors_list else "Unknown",
                            risk_level=risk
                        ))
                except (ValueError, AttributeError) as e:
                    print(f"Skipping file {file_path} due to date parsing error: {e}")
                    continue
        
        stale_files.sort(key=lambda x: x.days_since_modified, reverse=True)
        
        await update_status(workspace_id, 88, "Identifying hot spots...", "hot_spots")
        
        hot_spots = []
        for file_path, metadata in file_metadata.items():
            if metadata['commit_count'] > 10:
                frequency = "Very High" if metadata['commit_count'] > 50 else "High"
                
                hot_spots.append(HotSpot(
                    file_path=file_path,
                    commit_count=metadata['commit_count'],
                    contributor_count=len(metadata['contributors']),
                    last_modified=metadata['last_modified'] or "Unknown",
                    change_frequency=frequency
                ))
        
        hot_spots.sort(key=lambda x: x.commit_count, reverse=True)
        
        knowledge_dist = {
            c.username: c.total_commits
            for c in contributors_analysis[:10]
        }
        
        code_concentration = defaultdict(int)
        for file_path in all_files:
            dir_name = '/'.join(file_path.split('/')[:-1]) or 'root'
            code_concentration[dir_name] += 1
        
        await update_status(workspace_id, 92, "Analyzing codebase health...", "ai_health")
        
        await asyncio.sleep(2)
        
        health_analysis = await analyze_codebase_health_with_ai(
            len(all_files),
            len(commits),
            len(contributor_data),
            len(stale_files),
            len(hot_spots),
            knowledge_dist
        )
        
        codebase_health = CodebaseHealth(
            total_files=len(all_files),
            total_commits=len(commits),
            active_contributors=len(contributor_data),
            stale_files=stale_files[:20],
            hot_spots=hot_spots[:20],
            maintenance_concerns=health_analysis['maintenance_concerns'],
            code_concentration={k: v for k, v in list(code_concentration.items())[:10]},
            overall_bus_factor=health_analysis['overall_bus_factor'],
            risk_assessment=health_analysis['risk_assessment'],
            knowledge_distribution=knowledge_dist
        )
        
        response = AnalysisResponse(
            workspace_id=workspace_id,
            repository_name=repo_info['full_name'],
            repository_url=github_url,
            project_summary=project_summary,
            primary_languages=sorted(languages.keys(), key=lambda x: languages[x], reverse=True)[:5],
            contributors=contributors_analysis,
            codebase_health=codebase_health,
            recommendations=health_analysis['recommendations'],
            analysis_timestamp=datetime.utcnow().isoformat(),
            metadata={
                'stars': repo_info.get('stargazers_count', 0),
                'forks': repo_info.get('forks_count', 0),
                'open_issues': repo_info.get('open_issues_count', 0),
                'default_branch': repo_info.get('default_branch', 'main'),
                'created_at': repo_info.get('created_at'),
                'updated_at': repo_info.get('updated_at'),
                'size_kb': repo_info.get('size', 0),
                'commits_analyzed': len(commits)
            }
        )
        
        analysis_cache[workspace_id] = response
        
        await update_status(workspace_id, 100, "Analysis complete!", "completed")
        
        return response
        
    except Exception as e:
        error_message = str(e)
        print(f"Analysis failed for {workspace_id}: {error_message}")
        
        analysis_jobs[workspace_id] = AnalysisStatus(
            workspace_id=workspace_id,
            status="failed",
            progress=0,
            message=error_message if len(error_message) < 200 else error_message[:200] + "...",
            current_step="error"
        )
        
        return None

@app.post("/api/analyze")
async def start_analysis(request: AnalysisRequest, background_tasks: BackgroundTasks):
    """Start repository analysis (async)"""
    workspace_id = request.workspace_id or f"ws_{int(datetime.utcnow().timestamp() * 1000)}"
    
    analysis_jobs[workspace_id] = AnalysisStatus(
        workspace_id=workspace_id,
        status="pending",
        progress=0,
        message="Starting analysis...",
        current_step="initialization"
    )
    
    background_tasks.add_task(
        analyze_repository_full,
        request.github_url,
        workspace_id,
        request.max_commits or 1000,
        request.deep_analysis if request.deep_analysis is not None else True
    )
    
    return {
        "workspace_id": workspace_id,
        "message": "Analysis started",
        "status_url": f"/api/status/{workspace_id}",
        "result_url": f"/api/result/{workspace_id}"
    }

@app.get("/api/status/{workspace_id}", response_model=AnalysisStatus)
async def get_status(workspace_id: str):
    """Get analysis status"""
    if workspace_id not in analysis_jobs:
        raise HTTPException(status_code=404, detail="Workspace not found")
    return analysis_jobs[workspace_id]

@app.get("/api/result/{workspace_id}", response_model=AnalysisResponse)
async def get_result(workspace_id: str):
    """Get analysis result"""
    if workspace_id not in analysis_cache:
        # Check if still processing
        if workspace_id in analysis_jobs:
            status = analysis_jobs[workspace_id]
            if status.status == "processing":
                raise HTTPException(status_code=202, detail="Analysis still in progress")
            elif status.status == "failed":
                raise HTTPException(status_code=500, detail=status.message)
        raise HTTPException(status_code=404, detail="Result not found")
    
    return analysis_cache[workspace_id]

@app.post("/api/analyze/sync", response_model=AnalysisResponse)
async def analyze_sync(request: AnalysisRequest):
    """Synchronous analysis (blocks until complete)"""
    workspace_id = request.workspace_id or f"ws_{int(datetime.utcnow().timestamp() * 1000)}"
    return await analyze_repository_full(
        request.github_url,
        workspace_id,
        request.max_commits or 1000,
        request.deep_analysis if request.deep_analysis is not None else True
    )

@app.get("/api/health")
async def health_check():
    """Health check"""
    return {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "gemini_configured": bool(GEMINI_API_KEY),
        "github_token_configured": bool(GITHUB_TOKEN),
        "active_jobs": len(analysis_jobs),
        "cached_results": len(analysis_cache)
    }

@app.delete("/api/workspace/{workspace_id}")
async def delete_workspace(workspace_id: str):
    """Delete workspace data"""
    deleted = False
    if workspace_id in analysis_jobs:
        del analysis_jobs[workspace_id]
        deleted = True
    if workspace_id in analysis_cache:
        del analysis_cache[workspace_id]
        deleted = True
    
    if not deleted:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    return {"message": "Workspace deleted", "workspace_id": workspace_id}

@app.get("/")
async def root():
    """API documentation"""
    return {
        "service": "GitHub Repository Analyzer",
        "version": "1.0.0",
        "endpoints": {
            "POST /api/analyze": "Start async analysis",
            "GET /api/status/{workspace_id}": "Get analysis status",
            "GET /api/result/{workspace_id}": "Get analysis result",
            "POST /api/analyze/sync": "Synchronous analysis",
            "DELETE /api/workspace/{workspace_id}": "Delete workspace",
            "GET /api/health": "Health check"
        },
        "documentation": "/docs"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)