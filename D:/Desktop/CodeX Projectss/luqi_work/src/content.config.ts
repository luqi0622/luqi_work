import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
    featured: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/projects' }),
  schema: z.object({
    name: z.string(),
    description: z.string(),
    status: z.enum(['live', 'opensource', 'experimental', 'wip']),
    tech: z.array(z.string()).default([]),
    url: z.string().optional(),
    repo: z.string().optional(),
    cover: z.string().optional(),
    featured: z.boolean().default(false),
    order: z.number().default(99),
  }),
});

export const collections = { blog, projects };
