import { NextRequest,NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'; import { requireMemberApi } from '@/lib/auth/requireMemberApi'; import { parseProjectCommand } from '@/lib/work/project-command'
import { logProjectActivity } from '@/lib/work/project-activity'
interface Ctx { params:Promise<{id:string}> }
export async function POST(req:NextRequest,{params}:Ctx){
 const auth=await requireMemberApi(); if(auth.error)return auth.error
 const {id}=await params; const body=await req.json().catch(()=>null) as {command?:string;confirm?:boolean}|null
 const parsed=parseProjectCommand(body?.command??''); if(!parsed)return NextResponse.json({error:'“할일/마일스톤/리스크/결정 추가: 내용” 형식으로 입력해주세요'},{status:400})
 if(!body?.confirm)return NextResponse.json({preview:parsed,requiresConfirmation:true})
 const db=await createClient() as any
 const {data:project}=await db.from('projects').select('user_id').eq('id',id).maybeSingle()
 if(!project)return NextResponse.json({error:'프로젝트를 찾을 수 없습니다'},{status:404})
 const {data,error}=await db.from('project_items').insert({project_id:id,kind:parsed.kind,title:parsed.title,status:parsed.status,created_by:auth.user.id}).select('id,kind,title,status').single()
 if(error)return NextResponse.json({error:'실행 권한이 없거나 저장에 실패했습니다'},{status:403})
 await logProjectActivity(db,{projectId:id,ownerId:project.user_id,actorId:auth.user.id,action:'update',status:'success',after:data,evidence:{source:'natural_language_command',command:body.command}})
 return NextResponse.json({executed:true,item:data})
}
