import type {
  Education,
  Experience,
  Profile,
  Project,
  ProjectSummary,
} from '../schema/content.schema.js';
import type { DataResponseBody } from './data.view.js';

// Copied field by field on purpose: a new model property (or an old cache entry's extra one)
// only reaches clients once it's added here.

export function renderProfile(profile: Profile): DataResponseBody<Profile> {
  return {
    data: {
      fullName: profile.fullName,
      headline: profile.headline,
      summary: profile.summary,
      location: profile.location,
      links: profile.links.map((link) => ({ label: link.label, url: link.url, text: link.text })),
      experiences: profile.experiences.map(toExperience),
      education: profile.education.map(toEducation),
      contentUpdatedAt: profile.contentUpdatedAt,
    },
  };
}

export function renderProjectList(projects: ProjectSummary[]): DataResponseBody<ProjectSummary[]> {
  return { data: projects.map(toProjectSummary) };
}

export function renderProject(project: Project): DataResponseBody<Project> {
  return {
    data: {
      ...toProjectSummary(project),
      description: project.description,
      sections: project.sections.map((section) => ({
        heading: section.heading,
        body: section.body,
        points: section.points,
      })),
      updatedAt: project.updatedAt,
    },
  };
}

function toExperience(experience: Experience): Experience {
  return {
    id: experience.id,
    company: experience.company,
    role: experience.role,
    startDate: experience.startDate,
    endDate: experience.endDate,
    highlights: experience.highlights,
  };
}

function toEducation(entry: Education): Education {
  return {
    id: entry.id,
    institution: entry.institution,
    qualification: entry.qualification,
    startDate: entry.startDate,
    endDate: entry.endDate,
    highlights: entry.highlights,
  };
}

function toProjectSummary(project: ProjectSummary): ProjectSummary {
  return {
    slug: project.slug,
    title: project.title,
    summary: project.summary,
    techStack: project.techStack,
    repoUrl: project.repoUrl,
    liveUrl: project.liveUrl,
    featured: project.featured,
  };
}
