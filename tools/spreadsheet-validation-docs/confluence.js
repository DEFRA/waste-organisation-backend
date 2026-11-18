import MarkdownIt from 'markdown-it'

const publishVariableNames = ['CONFLUENCE_BASE_URL', 'CONFLUENCE_EMAIL', 'CONFLUENCE_API_TOKEN', 'CONFLUENCE_PAGE_ID']

const markdown = new MarkdownIt({ html: false, xhtmlOut: true })

const listed = (names) => (names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`)

export const assertPublishVariables = (env) => {
  const missing = publishVariableNames.filter((name) => !env[name]?.trim())
  if (missing.length > 0) {
    throw new Error(`Set ${listed(missing)} before publishing to Confluence.`)
  }
}

const confluenceJson = async (fetchImpl, url, options) => {
  const response = await fetchImpl(url, options)
  const text = await response.text()
  if (!response.ok) {
    throw new Error(`Confluence ${options.method ?? 'GET'} ${url} failed (${response.status}): ${text}`)
  }
  return text ? JSON.parse(text) : {}
}

export const publishMarkdown = async (source, env, fetchImpl = globalThis.fetch) => {
  assertPublishVariables(env)
  const baseUrl = env.CONFLUENCE_BASE_URL.replace(/\/$/, '')
  const pageUrl = `${baseUrl}/api/v2/pages/${encodeURIComponent(env.CONFLUENCE_PAGE_ID)}`
  const headers = {
    Authorization: `Basic ${Buffer.from(`${env.CONFLUENCE_EMAIL}:${env.CONFLUENCE_API_TOKEN}`).toString('base64')}`,
    Accept: 'application/json',
    'Content-Type': 'application/json'
  }
  const current = await confluenceJson(fetchImpl, pageUrl, { headers })
  const nextVersion = current.version.number + 1
  await confluenceJson(fetchImpl, pageUrl, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      id: env.CONFLUENCE_PAGE_ID,
      status: 'current',
      title: current.title,
      body: { representation: 'storage', value: markdown.render(source) },
      version: { number: nextVersion, message: 'Published from the spreadsheet validation rules tool.' }
    })
  })
  return { title: current.title, version: nextVersion }
}
