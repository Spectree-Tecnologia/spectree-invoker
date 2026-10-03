// Windows 8+: contain the suspended child before running any of its instructions.
// No breakaway flags; the non-inherited job handle kills descendants if this host dies.
using System;
using System.IO;
using System.Text;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class SpectreeJob {
  [StructLayout(LayoutKind.Sequential)] struct SA { public int size; public IntPtr descriptor; public int inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct SI {
    public int cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xChars,yChars,fill,flags;
    public short show, reservedSize; public IntPtr reservedPtr, input, output, error;
  }
  [StructLayout(LayoutKind.Sequential)] struct PI { public IntPtr process, thread; public uint pid, tid; }
  [StructLayout(LayoutKind.Sequential)] struct BasicLimit {
    public long processTime, jobTime; public uint flags; public UIntPtr min, max; public uint active;
    public UIntPtr affinity; public uint priority, scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO { public ulong r,w,o,rb,wb,ob; }
  [StructLayout(LayoutKind.Sequential)] struct Limits { public BasicLimit basic; public IO io; public UIntPtr pm,jm,peakp,peakj; }
  [StructLayout(LayoutKind.Sequential)] struct Accounting {
    public long user,kernel,periodUser,periodKernel; public uint faults,total,active,terminated;
  }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObject(IntPtr a,string name);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr OpenJobObject(uint access,bool inherit,string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr j,int c,ref Limits l,int n);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr j,int c,out Accounting a,int n,IntPtr ret);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool AssignProcessToJobObject(IntPtr j,IntPtr p);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr j,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateProcess(IntPtr p,uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint ResumeThread(IntPtr t);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint ms);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetExitCodeProcess(IntPtr p,out uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr h);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFile(string name,uint access,uint share,ref SA sa,uint creation,uint flags,IntPtr template);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcess(string app,StringBuilder command,IntPtr pa,IntPtr ta,bool inherit,uint flags,IntPtr env,string cwd,ref SI si,out PI pi);
  static void Check(bool ok) { if (!ok) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error()); }
  static uint Active(IntPtr j) { Accounting a; Check(QueryInformationJobObject(j,1,out a,Marshal.SizeOf(typeof(Accounting)),IntPtr.Zero)); return a.active; }
  static string Quote(string s) {
    var b = new StringBuilder("\""); int slashes=0;
    foreach(char c in s) { if(c=='\\') { slashes++; continue; } if(c=='"') b.Append('\\',slashes*2+1); else b.Append('\\',slashes); b.Append(c); slashes=0; }
    b.Append('\\',slashes*2); return b.Append('"').ToString();
  }
  static void Receipt(string dir,string id,string state,uint pid,string code,string error) {
    string value="{\"id\":\""+id+"\",\"state\":\""+state+"\",\"pid\":"+pid+",\"exit_code\":"+code+",\"error\":"+(error==null?"null":"\""+error+"\"")+"}";
    string target=Path.Combine(dir,"receipt.json"), temp=target+".tmp";
    File.WriteAllText(temp,value,new UTF8Encoding(false));
    if(File.Exists(target)) File.Replace(temp,target,null); else File.Move(temp,target);
  }
  public static string Inspect(string name) {
    IntPtr j=OpenJobObject(4,false,name);
    if(j==IntPtr.Zero) return Marshal.GetLastWin32Error()==2 ? "stopped" : "unknown";
    try { return Active(j)==0 ? "stopped" : "active"; } finally { CloseHandle(j); }
  }
  public static void Run(string id,string file,string[] args,bool verbatim,string cwd,string dir,int ownerPid,int timeout,int maxBuffer) {
    IntPtr j=IntPtr.Zero; PI pi=new PI(); IntPtr input=IntPtr.Zero, output=IntPtr.Zero, err=IntPtr.Zero;
    bool assigned=false; string error=null; string code="null";
    try {
      // Hold the original owner's process handle; PID reuse cannot keep a run alive.
      using(Process owner=Process.GetProcessById(ownerPid)) {
        IntPtr ownerHandle=owner.Handle;
        j=CreateJobObject(IntPtr.Zero,"Local\\Spectree-"+id); Check(j!=IntPtr.Zero);
        Limits limits=new Limits(); limits.basic.flags=0x2000; // KILL_ON_JOB_CLOSE
        Check(SetInformationJobObject(j,9,ref limits,Marshal.SizeOf(typeof(Limits))));
        SA sa=new SA(); sa.size=Marshal.SizeOf(typeof(SA)); sa.inherit=1;
        input=CreateFile(Path.Combine(dir,"stdin"),0x80000000,3,ref sa,3,0,IntPtr.Zero);
        output=CreateFile(Path.Combine(dir,"stdout"),0x40000000,3,ref sa,2,0,IntPtr.Zero);
        err=CreateFile(Path.Combine(dir,"stderr"),0x40000000,3,ref sa,2,0,IntPtr.Zero);
        Check(input.ToInt64()!=-1 && output.ToInt64()!=-1 && err.ToInt64()!=-1);
        SI si=new SI(); si.cb=Marshal.SizeOf(typeof(SI)); si.flags=0x100; si.input=input; si.output=output; si.error=err;
        string command=Quote(file); foreach(string a in args) command+=" "+(verbatim?a:Quote(a));
        Check(CreateProcess(null,new StringBuilder(command),IntPtr.Zero,IntPtr.Zero,true,0x08000004,IntPtr.Zero,cwd,ref si,out pi));
        Check(AssignProcessToJobObject(j,pi.process)); assigned=true;
        Receipt(dir,id,"running",pi.pid,"null",null);
        if(WaitForSingleObject(ownerHandle,0)==0) throw new Exception("Owner exited before launch");
        Check(ResumeThread(pi.thread)!=0xffffffff);
        var timer=Stopwatch.StartNew();
        while(WaitForSingleObject(pi.process,30)==258) {
          if(WaitForSingleObject(ownerHandle,0)==0) { error="E_OWNER_EXIT"; break; }
          if(timer.ElapsedMilliseconds>=timeout) { error="ETIMEDOUT"; break; }
          if(new FileInfo(Path.Combine(dir,"stdout")).Length>maxBuffer || new FileInfo(Path.Combine(dir,"stderr")).Length>maxBuffer) { error="ENOBUFS"; break; }
        }
        uint exit; if(error==null && GetExitCodeProcess(pi.process,out exit)) code=exit.ToString();
        if(error==null && (new FileInfo(Path.Combine(dir,"stdout")).Length>maxBuffer || new FileInfo(Path.Combine(dir,"stderr")).Length>maxBuffer)) error="ENOBUFS";
        // A successful parent may leave children alive. Clean these up but don't accept that run.
        // Accounting can briefly retain children that are already exiting after a test runner.
        if(error==null) { var grace=Stopwatch.StartNew(); while(Active(j)>0 && grace.ElapsedMilliseconds<500) Thread.Sleep(20); }
        if(error==null && Active(j)>0) error="E_PROCESS_DESCENDANTS";
        Check(TerminateJobObject(j,1));
        var drain=Stopwatch.StartNew(); while(Active(j)>0 && drain.ElapsedMilliseconds<5000) Thread.Sleep(20);
        Receipt(dir,id,Active(j)==0?"stopped":"unknown",pi.pid,code,error);
      }
    } catch(Exception e) {
      Console.Error.WriteLine(e.Message);
      bool stopped=false;
      if(assigned && j!=IntPtr.Zero) { TerminateJobObject(j,1); try { for(int i=0;i<250 && Active(j)>0;i++) Thread.Sleep(20); stopped=Active(j)==0; } catch {} }
      else if(pi.process!=IntPtr.Zero) { TerminateProcess(pi.process,1); stopped=WaitForSingleObject(pi.process,5000)==0; }
      else stopped=true; // No child was started.
      Receipt(dir,id,stopped?"stopped":"unknown",pi.pid,"null","E_PROCESS_LAUNCH");
    } finally {
      foreach(IntPtr h in new IntPtr[]{pi.thread,pi.process,input,output,err,j}) if(h!=IntPtr.Zero && h.ToInt64()!=-1) CloseHandle(h);
    }
  }
}
