import { Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../db';
import { Role } from '@prisma/client';

export const CreateProjectSchema = z.object({
  body: z.object({
    name: z.string().min(2)
  })
});

export const UpdateProjectSchema = z.object({
  body: z.object({
    name: z.string().min(2)
  })
});

export const UpdateOrgSchema = z.object({
  body: z.object({
    name: z.string().min(2)
  })
});

// Projects CRUD
export async function listProjects(req: Request, res: Response) {
  const orgId = req.user!.orgId;

  try {
    const projects = await prisma.project.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' }
    });
    return res.json(projects);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function getProject(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const project = await prisma.project.findFirst({
      where: { id, orgId }
    });

    if (!project) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Project not found' }
      });
    }

    return res.json(project);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function createProject(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { name } = req.body;

  try {
    const project = await prisma.project.create({
      data: {
        name,
        orgId
      }
    });
    return res.status(201).json(project);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function updateProject(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;
  const { name } = req.body;

  try {
    const project = await prisma.project.findFirst({
      where: { id, orgId }
    });

    if (!project) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Project not found' }
      });
    }

    const updated = await prisma.project.update({
      where: { id },
      data: { name }
    });

    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function deleteProject(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { id } = req.params;

  try {
    const project = await prisma.project.findFirst({
      where: { id, orgId }
    });

    if (!project) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Project not found' }
      });
    }

    // Verify if there are any queues associated. Since onDelete is Restrict on Queue -> Project,
    // we should check and return a clean error if queues exist.
    const queuesCount = await prisma.queue.count({ where: { projectId: id } });
    if (queuesCount > 0) {
      return res.status(400).json({
        error: {
          code: 'PRECONDITION_FAILED',
          message: 'Cannot delete project because it has queues. Delete all queues first.'
        }
      });
    }

    await prisma.project.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

// Organization Details
export async function getOrganization(req: Request, res: Response) {
  const orgId = req.user!.orgId;

  try {
    const org = await prisma.organization.findUnique({
      where: { id: orgId },
      include: {
        _count: {
          select: { users: true, projects: true }
        }
      }
    });

    if (!org) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Organization not found' }
      });
    }

    return res.json(org);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function updateOrganization(req: Request, res: Response) {
  const orgId = req.user!.orgId;
  const { name } = req.body;

  if (req.user!.role !== Role.ADMIN) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only administrators can update the organization name' }
    });
  }

  try {
    const updated = await prisma.organization.update({
      where: { id: orgId },
      data: { name }
    });
    return res.json(updated);
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}
