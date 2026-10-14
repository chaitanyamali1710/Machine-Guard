import jwt from 'jsonwebtoken';
import type { NextFunction, Response } from 'express';
import type { AuthedRequest, AuthUser, Role } from './types.js';

// The fallback keeps local development frictionless; index.ts refuses to boot without a real
// secret in production, so a deployed build can never sign tokens with a public value.
const secret=()=>process.env.JWT_SECRET||'local-development-secret-change-me-123456';
export function sign(user:AuthUser){return jwt.sign(user,secret(),{expiresIn:'8h'});}
export function requireAuth(req:AuthedRequest,res:Response,next:NextFunction){const value=req.headers.authorization;if(!value?.startsWith('Bearer '))return res.status(401).json({message:'Authentication required'});try{req.user=jwt.verify(value.slice(7),secret()) as AuthUser;next();}catch{return res.status(401).json({message:'Session expired or invalid'});}}
export function allow(...roles:Role[]){return(req:AuthedRequest,res:Response,next:NextFunction)=>req.user&&roles.includes(req.user.role)?next():res.status(403).json({message:'Insufficient permission'});}
