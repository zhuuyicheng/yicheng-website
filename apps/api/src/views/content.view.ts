import type {
  Education,
  Experience,
  Profile,
  Project,
  ProjectSummary,
} from '../schema/content.schema.js';

/** Success envelope. See DESIGN.md §7.1. */
export interface DataResponseBody<T> {
  data: T;
}

// Fields are copied one by one on purpose: a property added to a model (or present in an old
// cache entry) only reaches clients once it is added here.

export function renderProfile(profile: Profile): DataResponseBody<Profile> {
  return {
    data: {
      fullName: profile.fullName,
      headline: profile.headline,
      summary: profile.summary,
      location: profile.location,
      links: profile.links.map((link) => ({ label: link.label, url: link.url })),
      experiences: profile.experiences.map(toExperience),
      education: profile.education.map(toEducation),
    },
  };
}

export function renderProjectList(projects: ProjectSummary[]): DataResponseBody<ProjectSummary[]> {
  return { data: projects.map(toProjectSummary) };
}

export function renderProject(project: Project): DataResponseBody<Project> {
  return { data: { ...toProjectSummary(project), description: project.description } };
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
