import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.PROFILE_GITHUB_TOKEN;
const username = process.env.PROFILE_USERNAME || "sangikousenuser";

if (!token) {
  throw new Error("PROFILE_GITHUB_TOKEN is required.");
}

const headers = {
  Authorization: `Bearer ${token}`,
  "User-Agent": `${username}-profile-readme`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status} for ${path}: ${body}`);
  }

  return response.json();
}

async function graphql(query, variables = {}) {
  const response = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const body = await response.json();

  if (!response.ok || body.errors) {
    throw new Error(`GitHub GraphQL error: ${JSON.stringify(body.errors || body)}`);
  }

  return body.data;
}

async function getAllRepos() {
  const repos = [];

  for (let page = 1; page <= 10; page += 1) {
    const chunk = await github(
      `/user/repos?visibility=all&affiliation=owner,collaborator,organization_member&sort=updated&per_page=100&page=${page}`,
    );

    repos.push(...chunk);

    if (chunk.length < 100) {
      break;
    }
  }

  return repos.filter((repo) => !repo.archived);
}

async function getContributionStats() {
  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          totalCommitContributions
          totalIssueContributions
          totalPullRequestContributions
          totalRepositoryContributions
          restrictedContributionsCount
          contributionCalendar {
            totalContributions
          }
        }
      }
    }
  `;

  const data = await graphql(query, { login: username });
  return data.user.contributionsCollection;
}

async function getLanguages(repos) {
  const totals = new Map();

  for (const repo of repos) {
    if (repo.fork) {
      continue;
    }

    try {
      const languages = await github(`/repos/${repo.full_name}/languages`);

      for (const [name, bytes] of Object.entries(languages)) {
        totals.set(name, (totals.get(name) || 0) + bytes);
      }
    } catch (error) {
      console.log(`Skipping languages for ${repo.full_name}: ${error.message}`);
    }
  }

  return [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, bytes]) => ({ name, bytes }));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value || 0);
}

function statLine(label, value, x, y) {
  return `
    <text x="${x}" y="${y}" fill="#C9D1D9" font-family="Arial, Helvetica, sans-serif" font-size="14">${escapeXml(label)}</text>
    <text x="${x + 230}" y="${y}" fill="#70A5FD" font-family="Arial, Helvetica, sans-serif" font-size="14" font-weight="700" text-anchor="end">${escapeXml(value)}</text>`;
}

function statsSvg({ repos, contributions }) {
  const ownRepos = repos.filter((repo) => repo.owner?.login?.toLowerCase() === username.toLowerCase());
  const privateRepos = repos.filter((repo) => repo.private);
  const stars = ownRepos.reduce((sum, repo) => sum + repo.stargazers_count, 0);
  const forks = ownRepos.reduce((sum, repo) => sum + repo.forks_count, 0);

  return `<svg width="495" height="195" viewBox="0 0 495 195" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} GitHub stats</title>
  <desc id="desc">GitHub stats generated from public and private repositories accessible to the profile token.</desc>
  <rect width="495" height="195" rx="6" fill="#1A1B27"/>
  <text x="24" y="38" fill="#70A5FD" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">${escapeXml(username)}'s GitHub Stats</text>
  ${statLine("Total contributions this year", formatNumber(contributions.contributionCalendar.totalContributions), 24, 74)}
  ${statLine("Private contributions", formatNumber(contributions.restrictedContributionsCount), 24, 100)}
  ${statLine("Commits", formatNumber(contributions.totalCommitContributions), 24, 126)}
  ${statLine("Repositories accessible", formatNumber(repos.length), 24, 152)}
  ${statLine("Private repositories", formatNumber(privateRepos.length), 24, 178)}
  ${statLine("Stars / Forks", `${formatNumber(stars)} / ${formatNumber(forks)}`, 250, 74)}
  ${statLine("Pull requests", formatNumber(contributions.totalPullRequestContributions), 250, 100)}
  ${statLine("Issues", formatNumber(contributions.totalIssueContributions), 250, 126)}
  ${statLine("Created repos", formatNumber(contributions.totalRepositoryContributions), 250, 152)}
</svg>
`;
}

function languageColor(index) {
  const colors = ["#70A5FD", "#BF91F3", "#38BDAE", "#F1E05A", "#FF7B72", "#FFA657", "#8B949E", "#3FB950"];
  return colors[index % colors.length];
}

function languagesSvg(languages) {
  const total = languages.reduce((sum, language) => sum + language.bytes, 0) || 1;
  let cursor = 24;

  const bars = languages
    .map((language, index) => {
      const width = Math.max(3, Math.round((language.bytes / total) * 447));
      const rect = `<rect x="${cursor}" y="58" width="${width}" height="10" fill="${languageColor(index)}"/>`;
      cursor += width;
      return rect;
    })
    .join("\n  ");

  const rows = languages
    .map((language, index) => {
      const x = index % 2 === 0 ? 24 : 260;
      const y = 98 + Math.floor(index / 2) * 26;
      const percentage = ((language.bytes / total) * 100).toFixed(1);

      return `<circle cx="${x + 5}" cy="${y - 4}" r="5" fill="${languageColor(index)}"/>
  <text x="${x + 18}" y="${y}" fill="#C9D1D9" font-family="Arial, Helvetica, sans-serif" font-size="13">${escapeXml(language.name)}</text>
  <text x="${x + 200}" y="${y}" fill="#8B949E" font-family="Arial, Helvetica, sans-serif" font-size="13" text-anchor="end">${percentage}%</text>`;
    })
    .join("\n  ");

  return `<svg width="495" height="195" viewBox="0 0 495 195" fill="none" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc">
  <title id="title">${escapeXml(username)} top languages</title>
  <desc id="desc">Top languages generated from public and private repositories accessible to the profile token.</desc>
  <rect width="495" height="195" rx="6" fill="#1A1B27"/>
  <text x="24" y="38" fill="#70A5FD" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">Top Languages</text>
  <clipPath id="bar">
    <rect x="24" y="58" width="447" height="10" rx="5"/>
  </clipPath>
  <g clip-path="url(#bar)">
  ${bars}
  </g>
  ${rows}
</svg>
`;
}

const repos = await getAllRepos();
const contributions = await getContributionStats();
const languages = await getLanguages(repos);

await mkdir("img", { recursive: true });
await writeFile("img/profile_stats.svg", statsSvg({ repos, contributions }));
await writeFile("img/profile_languages.svg", languagesSvg(languages));

console.log(`Generated SVGs from ${repos.length} accessible repositories.`);
