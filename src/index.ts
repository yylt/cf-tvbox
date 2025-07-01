import { parse } from 'jsonc-parser';

interface Env {
  JSON_URL: string;
  LIVETXT_URL: string;
  MAPS: string; // Stored as a JSON string
  REMOVES: string; // Stored as a JSON string
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const host = url.host;
    // Determine cache key
    const cacheKey = new Request(url.toString(), request);
    const cache = caches.default; // Get the default cache instance
    // Handle /live.txt route
    if (url.pathname === '/live.txt') {
      let response = await cache.match(cacheKey); // Try to find a cached response

      if (response) {
        console.log('Serving /live.txt from cache.');
        return response; // Return cached response if found
      }
      console.log('Fetching /live.txt and caching.');
      try {
        if (!env.LIVETXT_URL) {
          return new Response('LIVETXT_URL is not configured in environment variables.', { status: 500 });
        }
        const liveTxtResponse = await fetch(env.LIVETXT_URL);
        if (!liveTxtResponse.ok) {
          throw new Error(`Failed to fetch live.txt content from ${env.LIVETXT_URL}: ${liveTxtResponse.statusText}`);
        }
        const liveTxtContent = await liveTxtResponse.text();
        
        const response = new Response(liveTxtContent, {
          headers: { 
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=3600' // Cache for 1 hours (60 * 60 seconds)
          },
        });
        ctx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;

      } catch (error: any) {
        console.error('Error fetching live.txt:', error);
        return new Response(`Internal Server Error fetching live.txt: ${error.message}`, { status: 500 });
      }
    }

    // Handle / or no path route
    if (url.pathname === '/' || url.pathname === '') {
      console.log('Fetching / and caching.');
      try {
        // Parse MAPS (k1=v1,k2=v2 format)
        const maps: { [key: string]: string } = {};
        if (env.MAPS) {
          env.MAPS.split(',').forEach(pair => {
            const [key, value] = pair.split('=');
            if (key && value !== undefined) {
              maps[key.trim()] = value.trim();
            }
          });
        }
        console.log('Parsed Maps:', maps);

        // Parse REMOVE (k1,k2 format)
        const remove: string[] = env.REMOVES ? env.REMOVES.split(',').map(item => item.trim()) : [];
        console.log('Parsed Remove:', remove);

        // Fetch JSON data from env.jsonurl
        const jsonResponse = await fetch(env.JSON_URL);
        if (!jsonResponse.ok) {
          throw new Error(`Failed to fetch JSON from ${env.JSON_URL}: ${jsonResponse.statusText}`);
        }
        let rawJsonText = await jsonResponse.text();
        const data: any = parse(rawJsonText); // Using jsonc-parser
        if (data) {
          if (data.wallpaper !== undefined) {
            delete data.wallpaper;
          }
          if (data.ads !== undefined) {
            delete data.ads;
          }
        }
        // Process 'sites' list
        if (data && Array.isArray(data.sites)) {
          // Update sites
          for (const site of data.sites) {
            if (typeof site.name === 'string') {
              // Remove leading junk characters
              site.name = site.name.replace(/^[^a-zA-Z0-9\u4e00-\u9fff\s\.\-_()\[\]{}\|]*([\s\S]*)$/, '$1').trim();
              // Split by '┃' and take the last part
              site.name = site.name.split('┃', 1).pop() || site.name;

              // Apply maps
              for (const key in maps) {
                if (site.name.includes(key)) {
                  console.log(`name: ${site.name} find key: ${key}`);
                  site.name = maps[key];
                  break;
                }
              }
            }
          }

          // Filter out sites based on remove list
          data.sites = data.sites.filter((site: any) => {
            if (typeof site.name === 'string') {
              if (remove.some(k => site.name.includes(k))) {
                console.log(`name: ${site.name} in remove list`);
                return false;
              }
            }
            return true;
          });
        }

        // Modify 'lives' field
        data.lives = [{
          name: "tvlive",
          type: 0,
          url: `https://${host}/live.txt`,
          playerType: 1
        }];

        const response = new Response(JSON.stringify(data), {
          headers: { 
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=1800' // Cache for (30 * 60 seconds)
          },
        });

        // Store the response in cache
        return response;

      } catch (error: any) {
        console.error('Error processing request:', error);
        return new Response(`Internal Server Error: ${error.message}`, { status: 500 });
      }
    }

    // Default response for other paths
    return new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
