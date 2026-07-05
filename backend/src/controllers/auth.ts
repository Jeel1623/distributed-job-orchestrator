import { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import prisma from '../db';
import { Role } from '@prisma/client';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback_secret_key_for_dev_only!';
const REFRESH_SECRET = process.env.REFRESH_SECRET || 'fallback_refresh_secret_key_for_dev_only!';

export const RegisterSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
    role: z.nativeEnum(Role).optional(),
    orgName: z.string().min(2)
  })
});

export const LoginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string()
  })
});

export const RefreshSchema = z.object({
  body: z.object({
    refreshToken: z.string()
  })
});

export async function register(req: Request, res: Response) {
  const { email, password, role, orgName } = req.body;

  try {
    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      return res.status(409).json({
        error: { code: 'CONFLICT', message: 'User with this email already exists' }
      });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // Create Organization, Project, and User in a transaction
    const result = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: { name: orgName }
      });

      // Also create a default project for convenience
      const project = await tx.project.create({
        data: {
          name: 'Default Project',
          orgId: org.id
        }
      });

      // Create a default Queue as well
      const retryPolicy = await tx.retryPolicy.create({
        data: {
          name: 'Default Exponential Retry',
          strategy: 'EXPONENTIAL',
          baseDelayMs: 1000,
          maxRetries: 3,
          maxDelayMs: 10000
        }
      });

      await tx.queue.create({
        data: {
          name: 'default',
          priority: 1,
          maxConcurrency: 5,
          projectId: project.id,
          defaultRetryPolicyId: retryPolicy.id
        }
      });

      const user = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: role || Role.MEMBER,
          orgId: org.id
        }
      });

      return { user, org };
    });

    const accessToken = jwt.sign(
      { id: result.user.id, email: result.user.email, role: result.user.role, orgId: result.user.orgId },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: result.user.id },
      REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      user: {
        id: result.user.id,
        email: result.user.email,
        role: result.user.role,
        orgId: result.user.orgId
      },
      accessToken,
      refreshToken
    });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function login(req: Request, res: Response) {
  const { email, password } = req.body;

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' }
      });
    }

    const passwordValid = await bcrypt.compare(password, user.passwordHash);
    if (!passwordValid) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'Invalid email or password' }
      });
    }

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
      { id: user.id },
      REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId
      },
      accessToken,
      refreshToken
    });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}

export async function refresh(req: Request, res: Response) {
  const { refreshToken } = req.body;

  try {
    const decoded = jwt.verify(refreshToken, REFRESH_SECRET) as { id: string };
    
    const user = await prisma.user.findUnique({ where: { id: decoded.id } });
    if (!user) {
      return res.status(401).json({
        error: { code: 'UNAUTHORIZED', message: 'User not found' }
      });
    }

    const accessToken = jwt.sign(
      { id: user.id, email: user.email, role: user.role, orgId: user.orgId },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    const newRefreshToken = jwt.sign(
      { id: user.id },
      REFRESH_SECRET,
      { expiresIn: '7d' }
    );

    return res.json({
      accessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Invalid or expired refresh token' }
    });
  }
}

export async function me(req: Request, res: Response) {
  if (!req.user) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Not authenticated' }
    });
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      include: { organization: true }
    });

    if (!user) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'User not found' }
      });
    }

    return res.json({
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        orgId: user.orgId,
        organization: {
          id: user.organization.id,
          name: user.organization.name
        }
      }
    });
  } catch (error: any) {
    return res.status(500).json({
      error: { code: 'INTERNAL_SERVER_ERROR', message: error.message }
    });
  }
}
