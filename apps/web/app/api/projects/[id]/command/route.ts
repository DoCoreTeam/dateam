import { NextRequest,NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'; import { requireMemberApi } from '@/lib/auth/requireMemberApi'; import { parseProjectCommand } from '@/lib/work/project-command'
interface Ctx { params:Promise<{id:string}> }
export async function POST(req:NextRequest,{params}:Ctx){
 const auth=await requireMemberApi(); if(auth.error)return auth.error
 const {id}=await params; const body=await req.json().catch(()=>null) as {command?:string;confirm?:boolean}|null
 const parsed=parseProjectCommand(body?.command??''); if(!parsed)return NextResponse.json({error:'“할일/마일스톤/리스크/결정 추가: 내용” 형식으로 입력해주세요'},{status:400})
 if(!body?.confirm)return NextResponse.json({preview:parsed,requiresConfirmation:true})
 const db=await createClient() as any
 const {data,error}=await db.from('project_items').insert({project_id:id,kind:parsed.kind,title:parsed.title,status:parsed.status,created_by:auth.user.id}).select('id,kind,title,status').single()
 if(error)return NextResponse.json({error:'실행 권한이 없거나 저장에 실패했습니다'},{status:403})
 return NextResponse.json({executed:true,item:data})
}
